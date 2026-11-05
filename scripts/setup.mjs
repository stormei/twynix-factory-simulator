import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
if(existsSync('.env')){console.log('Existing .env retained.');}else{writeFileSync('.env',`HOST=127.0.0.1\nPORT=3000\nOPCUA_HOST=localhost\nOPCUA_PORT=4840\nOPCUA_USER=operator\nOPCUA_PASSWORD=${randomBytes(24).toString('base64url')}\nOPCUA_DEV=false\nDATA_DIR=./data\n`,{mode:0o600});console.log('Created .env with a unique operator password and secure OPC UA defaults.');}
