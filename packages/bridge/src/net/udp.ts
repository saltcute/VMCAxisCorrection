import { createSocket, type Socket } from 'node:dgram';

/** Bind a UDP4 socket, rejecting on bind errors (e.g. port already in use). */
export function bindUdp(port: number, host = '0.0.0.0'): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = createSocket({ type: 'udp4' });
    const onError = (err: Error) => {
      sock.close();
      reject(err);
    };
    sock.once('error', onError);
    sock.bind(port, host, () => {
      sock.off('error', onError);
      resolve(sock);
    });
  });
}

export function closeUdp(sock: Socket | null): Promise<void> {
  return new Promise((resolve) => {
    if (!sock) return resolve();
    try {
      sock.close(() => resolve());
    } catch {
      resolve();
    }
  });
}
