import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';
const args = process.argv.slice(2);
const host = args.length === 2 && args[0] === '--host' ? args[1] : '';
if (!host || !(isIP(host) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) {
  console.error('Usage: npm run docker:setup -- --host YOUR_SERVER_IP_OR_DNS_NAME');
  process.exit(1);
}
try {
  writeFileSync('.env.docker', `# Keep this file private. Never commit it.\nWEB_BIND_ADDRESS=127.0.0.1\nWEB_PORT=3000\nOPCUA_BIND_ADDRESS=0.0.0.0\nOPCUA_HOST=${host}\nOPCUA_PORT=4840\nOPCUA_USER=operator\nOPCUA_PASSWORD=${randomBytes(24).toString('base64url')}\nAPI_TOKEN=${randomBytes(32).toString('base64url')}\n`, {mode:0o600, flag:'wx'});
  console.log('Created .env.docker with unique credentials. See docs/docker.md for deployment and LAN web access.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Existing .env.docker retained. Edit it to change settings.');
  else throw error;
}
