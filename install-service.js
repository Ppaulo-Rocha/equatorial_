const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'EquatorialAutoInvoice',
  description: 'Serviço automático para download de faturas da Equatorial',
  script: path.join(__dirname, 'service.js'),
  nodeOptions: ['--max_old_space_size=4096'],
  env: [{ name: 'NODE_ENV', value: 'production' }],
});

svc.on('install', () => {
  console.log('\nServiço "EquatorialAutoInvoice" instalado com sucesso.');
  console.log('O serviço foi configurado para iniciar automaticamente com o Windows.');
  console.log('Gerencie em: Win+R > services.msc\n');
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log('\nO serviço "EquatorialAutoInvoice" já está instalado.');
  console.log('Para reinstalar, execute: npm run uninstall-service\n');
});

svc.on('start', () => {
  console.log('Serviço iniciado com sucesso.');
  console.log(`Logs: ${path.join(__dirname, 'logs', 'service.log')}\n`);
});

svc.on('error', (err) => {
  console.error('\nErro ao instalar o serviço:', err);
});

console.log('\nInstalando "EquatorialAutoInvoice"...\n');
svc.install();

