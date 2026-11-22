// Servidor de desarrollo + actualización de datos de XM cada 30 minutos.
// Uso: npm run vivo
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const xm = () => { console.log(`[vivo] ${new Date().toLocaleTimeString('es-CO')} actualizando datos de XM...`); for (const f of ['xm', 'mix', 'riesgo']) run('node', [`scripts/fetch-${f}.mjs`]); };
xm(); setInterval(xm, 30 * 60 * 1000);
run('npx', ['vite']);
