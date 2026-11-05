import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',use:{baseURL:'http://127.0.0.1:3100',viewport:{width:1600,height:1000},headless:true},webServer:{command:`OPCUA_DEV=true OPCUA_PORT=14841 PORT=3100 DATA_DIR=${mkdtempSync(join(tmpdir(),'twynix-e2e-'))} npm start`,url:'http://127.0.0.1:3100/api/health',reuseExistingServer:false},timeout:30000});
