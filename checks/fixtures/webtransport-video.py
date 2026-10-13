"""Loopback-only HTTP/3 fixture. Requires aioquic==1.3.0 and ffmpeg; no product dependency."""
import argparse
import asyncio
import datetime
import functools
import ipaddress
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

from aioquic.asyncio import QuicConnectionProtocol, serve
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import HeadersReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ConnectionTerminated, ProtocolNegotiated, StreamReset, StopSendingReceived
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID


def record(body):
    return struct.pack('>I', len(body)) + body


def metadata(timestamp):
    # Complete MISB ST 0601 packet: timestamp and a per-frame latitude marker.
    # Parsing belongs to the optional external fyraklv consumer, not this fixture.
    local_set = b'\x02\x08' + struct.pack('>Q', 1700000000000000 + timestamp)
    local_set += b'\x0d\x04' + struct.pack('>i', (timestamp // 50000) * 100000)
    local_set += b'\x0e\x04\x00\x00\x00\x00'
    klv = bytes.fromhex('060e2b34020b01010e01030101000000') + bytes([len(local_set)]) + local_set
    return record(b'\x03\x01' + struct.pack('>QI', timestamp, 300) + klv)


def generate_video(ffmpeg, directory, hevc=False):
    target = directory / ('test.h265' if hevc else 'test.h264')
    args = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
            'testsrc2=size=320x200:rate=20', '-t', '2', '-an', '-pix_fmt', 'yuv420p']
    if hevc:
        args += ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency',
                 '-x265-params', 'aud=1:repeat-headers=1:keyint=10:min-keyint=10:scenecut=0:level-idc=2:log-level=error:pools=1', '-f', 'hevc']
    else:
        args += ['-c:v', 'libx264', '-profile:v', 'baseline', '-preset', 'ultrafast',
                 '-tune', 'zerolatency', '-x264-params', 'aud=1:repeat-headers=1:keyint=10:min-keyint=10:scenecut=0', '-f', 'h264']
    subprocess.run(args + [str(target)], check=True, timeout=30, capture_output=True)
    raw = target.read_bytes()
    starts = list(re.finditer(b'\x00\x00(?:\x00)?\x01', raw))
    nals = [(raw[m.end():starts[i + 1].start() if i + 1 < len(starts) else len(raw)], m.start()) for i, m in enumerate(starts)]
    kind = (lambda nal: (nal[0] >> 1) & 63) if hevc else (lambda nal: nal[0] & 31)
    sps = next(nal for nal, _ in nals if kind(nal) == (33 if hevc else 7))
    if hevc:
        rbsp = sps[2:].replace(b'\x00\x00\x03', b'\x00\x00')
        profile = rbsp[1]
        compatibility = int.from_bytes(rbsp[2:6], 'big')
        compatibility = int(f'{compatibility:032b}'[::-1], 2)
        constraints = rbsp[6:12].rstrip(b'\x00')
        codec = 'hvc1.' + ['', 'A', 'B', 'C'][profile >> 6] + str(profile & 31) + f'.{compatibility:X}.' + ('H' if profile & 32 else 'L') + str(rbsp[12])
        if constraints:
            codec += '.' + '.'.join(f'{byte:02X}' for byte in constraints)
    else:
        codec = 'avc1.' + sps[1:4].hex().upper()
    aud = [offset for nal, offset in nals if kind(nal) == (35 if hevc else 9)]
    units = []
    for i, start in enumerate(aud):
        end = aud[i + 1] if i + 1 < len(aud) else len(raw)
        key = any(start <= offset < end and kind(nal) in ([19, 20, 21] if hevc else [5]) for nal, offset in nals)
        units.append((key, raw[start:end]))
    if not units or not units[0][0]:
        raise RuntimeError('Fixture has no first keyframe')
    return {'codec': codec, 'codedWidth': 320, 'codedHeight': 200}, units


class VideoProtocol(QuicConnectionProtocol):
    def __init__(self, *args, videos, **kwargs):
        super().__init__(*args, **kwargs)
        self.http = None
        self.videos = videos
        self.tasks = set()
        self.stream_tasks = {}

    def quic_event_received(self, event):
        if isinstance(event, ProtocolNegotiated):
            self.http = H3Connection(self._quic, enable_webtransport=True)
        if isinstance(event, ConnectionTerminated):
            for task in self.tasks:
                task.cancel()
        if isinstance(event, (StreamReset, StopSendingReceived)):
            task = self.stream_tasks.pop(event.stream_id, None)
            if task:
                task.cancel()
        if self.http is None:
            return
        for received in self.http.handle_event(event):
            if not isinstance(received, HeadersReceived):
                continue
            headers = dict(received.headers)
            path = headers.get(b':path', b'').decode()
            if headers.get(b':method') != b'CONNECT' or headers.get(b':protocol') != b'webtransport' or path not in ['/video', '/hevc', '/hang', '/bad-config', '/metadata', '/burst', '/hevc-burst']:
                self.http.send_headers(received.stream_id, [(b':status', b'404')], end_stream=True)
                continue
            self.http.send_headers(received.stream_id, [(b':status', b'200'), (b'sec-webtransport-http3-draft', b'draft02')])
            self.transmit()
            print(json.dumps({'connect': path}), flush=True)
            if path != '/hang':
                task = asyncio.create_task(self.send_video(received.stream_id, path))
                self.tasks.add(task)
                task.add_done_callback(self.tasks.discard)

    async def send_video(self, session_id, path):
        await asyncio.sleep(0.1)
        stream_id = self.http.create_webtransport_stream(session_id, is_unidirectional=True)
        self.stream_tasks[stream_id] = asyncio.current_task()
        config, units = self.videos['hevc' if path.startswith('/hevc') else 'h264']
        if path == '/bad-config':
            config = {**config, 'codec': 'avc1.FF001E'}
        self._quic.send_stream_data(stream_id, record(b'\x01' + json.dumps(config).encode()))
        self.transmit()
        # 10 seconds, original media clock starts at 5 seconds, not captureStream zero.
        for index in range(200):
            if path == '/metadata' and index == 40:
                self._quic.send_stream_data(stream_id, record(b'\x01' + json.dumps(config).encode()))
                self.transmit()
                # Leave a visible reset interval before delivering the new timeline.
                await asyncio.sleep(0.25)
            timestamp = (1000017 + (index - 40) * 50000 if path == '/metadata' and index >= 40
                         else 5000000 + index * 50000 + (17 if path == '/metadata' else 0))
            if path == '/metadata':
                self._quic.send_stream_data(stream_id, metadata(timestamp))
            key, data = units[index % len(units)]
            packet = record(b'\x02' + bytes([int(key)]) + struct.pack('>QI', timestamp, 50000) + data)
            # Deliberately split both length header and body to exercise streaming parser.
            for part in [packet[:2], packet[2:11], packet[11:]]:
                self._quic.send_stream_data(stream_id, part)
            self.transmit()
            # Deliver the initial GOPs without pacing to exercise decoder warmup.
            # Later packets resume the normal 20fps cadence and allow keyframe recovery.
            if path not in ['/burst', '/hevc-burst'] or index >= 39:
                await asyncio.sleep(0.05)
        self._quic.send_stream_data(stream_id, b'', end_stream=True)
        self.transmit()


async def main(args):
    directory = Path(args.output).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'localhost')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(days=2))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .sign(key, hashes.SHA256()))
    (directory / 'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (directory / 'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    videos = {'h264': generate_video(args.ffmpeg, directory)}
    try:
        videos['hevc'] = generate_video(args.ffmpeg, directory, hevc=True)
    except (subprocess.SubprocessError, RuntimeError) as error:
        print(json.dumps({'hevcFixtureError': str(error)}), flush=True)
    configuration = QuicConfiguration(is_client=False, alpn_protocols=H3_ALPN, max_datagram_frame_size=65536)
    configuration.load_cert_chain(str(directory / 'cert.pem'), str(directory / 'key.pem'))
    server = await serve('127.0.0.1', args.port, configuration=configuration, create_protocol=functools.partial(VideoProtocol, videos=videos))
    manifest = {'url': f'https://127.0.0.1:{args.port}/video', 'hash': list(cert.fingerprint(hashes.SHA256())),
                'h264': videos['h264'][0], 'hevc': videos.get('hevc', [None])[0],
                'metadata': {'path': '/metadata', 'firstTimestamp': 5000017, 'resetTimestamp': 1000017}}
    (directory / 'ready.json').write_text(json.dumps(manifest), encoding='utf-8')
    print(json.dumps(manifest), flush=True)
    try:
        await asyncio.Future()
    finally:
        server.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=18443)
    parser.add_argument('--output', required=True)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    # Windows Proactor UDP reads may stop after ICMP from an already closed browser.
    # Selector keeps the loopback fixture accepting subsequent connections.
    factory = asyncio.SelectorEventLoop if sys.platform == 'win32' else None
    asyncio.run(main(parser.parse_args()), loop_factory=factory)
