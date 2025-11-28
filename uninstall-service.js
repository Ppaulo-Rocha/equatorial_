const Service = require('node-windows').Service;
const path = require('path');

// Cria um novo objeto de serviço
const svc = new Service({
    name: 'EquatorialAutoInvoice',
    script: path.join(__dirname, 'service.js')
});

// Listener de desinstalação
svc.on('uninstall', () => {
    console.log('\n✓ Serviço "EquatorialAutoInvoice" desinstalado com sucesso!');
    console.log('  O serviço foi removido do sistema.\n');
});

svc.on('alreadyuninstalled', () => {
    console.log('\n! O serviço "EquatorialAutoInvoice" não está instalado.\n');
});

svc.on('error', (err) => {
    console.error('\n✗ Erro ao desinstalar o serviço:', err);
});

// Desinstala o serviço
console.log('\n═══════════════════════════════════════════════════════════');
console.log('   DESINSTALANDO SERVIÇO WINDOWS');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('Desinstalando "EquatorialAutoInvoice"...\n');

svc.uninstall();
