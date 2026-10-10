import { createConnection } from 'node:net';

/**
 * Mailbox-level SMTP verification — a tier stricter than emailVerifier.js's
 * MX-only check. Connects to the domain's real mail server and runs the
 * handshake far enough to see the RCPT TO response, without ever sending
 * DATA/QUIT-after-send (no mail is actually delivered — this is the same
 * "probe, don't send" technique every email-verification SaaS uses).
 *
 * Deliberately conservative, same philosophy as emailVerifier.js: only a
 * server that explicitly rejects the mailbox (550/551/553/501/554 "no such
 * user") downgrades a lead to 'dead'. A clean 250/251 upgrades to 'alive'.
 * Everything else — timeout, connection refused, greylist 4xx, a server that
 * accepts all RCPTs (catch-all, can't be distinguished from a real mailbox
 * without actually sending) — resolves to 'unknown' and leaves whatever
 * emailVerifier.js already decided untouched. A flaky or blocked network
 * path must never look like proof the mailbox is dead.
 *
 * Real-world caveat found while building this: many networks (including the
 * one this was developed on) block outbound SMTP (ports 25 and 587)
 * entirely, which is indistinguishable at the TCP level from the target mail
 * server refusing the connection. Both resolve to 'unknown' here on purpose —
 * never to 'dead' — specifically so that running from a port-25-blocked
 * network degrades to "no stricter than before," not to wrongly killing
 * every lead it touches.
 */

function readLine(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      // An SMTP multi-line reply's final line has a space (not '-') after
      // the 3-digit code; wait for that before resolving.
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: parseInt(last.slice(0, 3), 10), text: buf });
      }
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onTimeout = () => { cleanup(); reject(new Error('SMTP read timeout')); };
    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    }
    const timer = setTimeout(onTimeout, timeoutMs);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', onTimeout);
  });
}

/**
 * Probes one (email, mxHost) pair. Returns 'alive' | 'dead' | 'unknown'.
 * Never throws — any failure resolves to 'unknown'.
 */
export async function probeMailbox(email, mxHost, { port = 25, timeoutMs = 8000, heloDomain = 'verify.local' } = {}) {
  let socket;
  try {
    socket = createConnection({ host: mxHost, port, timeout: timeoutMs });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('connect timeout')));
    });

    const greeting = await readLine(socket, timeoutMs);
    if (greeting.code !== 220) return 'unknown';

    socket.write(`EHLO ${heloDomain}\r\n`);
    const ehlo = await readLine(socket, timeoutMs);
    if (ehlo.code !== 250) return 'unknown';

    socket.write(`MAIL FROM:<probe@${heloDomain}>\r\n`);
    const mailFrom = await readLine(socket, timeoutMs);
    if (mailFrom.code !== 250) return 'unknown';

    socket.write(`RCPT TO:<${email}>\r\n`);
    const rcpt = await readLine(socket, timeoutMs);

    socket.write('QUIT\r\n');

    if (rcpt.code === 250 || rcpt.code === 251) return 'alive';
    if ([550, 551, 553, 501, 554].includes(rcpt.code)) return 'dead';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    socket?.destroy();
  }
}
