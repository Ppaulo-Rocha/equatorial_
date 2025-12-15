const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'EquatorialAutoInvoice',
  script: path.join(__dirname, 'service.js'),
});

svc.on('uninstall', () => {
  console.log('\nServiço "EquatorialAutoInvoice" desinstalado com sucesso.\n');
});

svc.on('alreadyuninstalled', () => {
  console.log('\nO serviço "EquatorialAutoInvoice" não está instalado.\n');
});

svc.on('error', (err) => {
  console.error('\nErro ao desinstalar o serviço:', err);
});

console.log('\nDesinstalando "EquatorialAutoInvoice"...\n');
svc.uninstall();

