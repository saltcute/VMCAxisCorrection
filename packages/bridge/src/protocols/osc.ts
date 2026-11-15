/** Minimal OSC 1.0 encoder: string, float32 and int32 arguments, messages and bundles. */
export type OscArg = string | number | { int: number };
export interface OscMessage {
  address: string;
  args: OscArg[];
}

function pad4(n: number): number {
  return (n + 3) & ~3;
}

function oscString(s: string): Buffer {
  const raw = Buffer.from(s, 'utf8');
  const buf = Buffer.alloc(pad4(raw.length + 1));
  raw.copy(buf);
  return buf;
}

export function encodeMessage(msg: OscMessage): Buffer {
  let tags = ',';
  const parts: Buffer[] = [];
  for (const a of msg.args) {
    if (typeof a === 'string') {
      tags += 's';
      parts.push(oscString(a));
    } else if (typeof a === 'number') {
      tags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(a);
      parts.push(b);
    } else {
      tags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(a.int);
      parts.push(b);
    }
  }
  return Buffer.concat([oscString(msg.address), oscString(tags), ...parts]);
}

/** Bundle with the "immediately" timetag. */
export function encodeBundle(msgs: OscMessage[]): Buffer {
  const parts: Buffer[] = [oscString('#bundle'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])];
  for (const m of msgs) {
    const body = encodeMessage(m);
    const size = Buffer.alloc(4);
    size.writeInt32BE(body.length);
    parts.push(size, body);
  }
  return Buffer.concat(parts);
}

/** Decode a single message (used by tests). */
export function decodeMessage(buf: Buffer): OscMessage {
  let off = 0;
  const readStr = () => {
    const end = buf.indexOf(0, off);
    const s = buf.toString('utf8', off, end);
    off = pad4(end + 1);
    return s;
  };
  const address = readStr();
  const tags = readStr().slice(1);
  const args: OscArg[] = [];
  for (const t of tags) {
    if (t === 's') args.push(readStr());
    else if (t === 'f') {
      args.push(buf.readFloatBE(off));
      off += 4;
    } else if (t === 'i') {
      args.push({ int: buf.readInt32BE(off) });
      off += 4;
    }
  }
  return { address, args };
}
