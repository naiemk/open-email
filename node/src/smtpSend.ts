import { createConnection, type Socket } from "node:net";

export type SmtpResult = {
  rcptCode: number;
  rcptLine: string;
  dataCode: number;
};

/** RFC 5321 client used in tests (same dialog swaks would send). */
export async function sendSmtp(opts: {
  host: string;
  port: number;
  from: string;
  to: string;
  data: string;
}): Promise<SmtpResult> {
  const socket = createConnection({ host: opts.host, port: opts.port });
  await onceConnect(socket);
  const greet = await readReply(socket);
  if (greet.code !== 220) throw new Error(greet.line);

  await expectCode(socket, `EHLO tracer.local`, 250);
  await expectCode(socket, `MAIL FROM:<${opts.from}>`, 250);
  const rcpt = await command(socket, `RCPT TO:<${opts.to}>`);
  if (rcpt.code >= 400) {
    await command(socket, "QUIT").catch(() => undefined);
    socket.end();
    return { rcptCode: rcpt.code, rcptLine: rcpt.line, dataCode: 0 };
  }
  await expectCode(socket, "DATA", 354);
  const body = opts.data.replace(/\n/g, "\r\n").replace(/^\./gm, "..");
  socket.write(`${body}\r\n.\r\n`);
  const data = await readReply(socket);
  await command(socket, "QUIT").catch(() => undefined);
  socket.end();
  return { rcptCode: rcpt.code, rcptLine: rcpt.line, dataCode: data.code };
}

function onceConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });
}

async function expectCode(socket: Socket, line: string, code: number) {
  const reply = await command(socket, line);
  if (reply.code !== code) throw new Error(`wanted ${code}, got ${reply.line}`);
  return reply;
}

async function command(socket: Socket, line: string) {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

function readReply(socket: Socket): Promise<{ code: number; line: string }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const parts = buf.split("\r\n");
      for (let i = 0; i < parts.length - 1; i++) {
        const line = parts[i]!;
        if (/^\d{3}-/.test(line)) continue;
        const m = /^(\d{3}) /.exec(line);
        if (!m) continue;
        socket.off("data", onData);
        socket.off("error", reject);
        resolve({ code: Number(m[1]), line });
        return;
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}
