const Service = require('node-windows').Service;
const path = require('path');

// Cria um novo objeto de serviço
const svc = new Service({
    name: 'EquatorialAutoInvoice',
    description: 'Serviço automático para download de faturas da Equatorial',
    script: path.join(__dirname, 'service.js'),
    nodeOptions: [
        '--harmony',
        '--max_old_space_size=4096'
    ],
    env: [
        {
            name: "NODE_ENV",
            value: "production"
        }
    ]
});

// Listener de instalação
svc.on('install', () => {
    console.log('\n✓ Serviço "EquatorialAutoInvoice" instalado com sucesso!');
    console.log('  O serviço foi configurado para iniciar automaticamente com o Windows.\n');
    console.log('Para gerenciar o serviço:');
    console.log('  - Abra o Gerenciador de Serviços: Win+R > services.msc');
    console.log('  - Procure por "EquatorialAutoInvoice"\n');

    // Inicia o serviço
    svc.start();
});

svc.on('alreadyinstalled', () => {
    console.log('\n! O serviço "EquatorialAutoInvoice" já está instalado.');
    console.log('  Para reinstalar, primeiro execute: npm run uninstall-service\n');
});

svc.on('start', () => {
    console.log('✓ Serviço iniciado com sucesso!\n');
    console.log('Logs do serviço podem ser encontrados em:');
    console.log(`  ${path.join(__dirname, 'logs', 'service.log')}\n`);
});

svc.on('error', (err) => {
    console.error('\n✗ Erro ao instalar o serviço:', err);
});

// Instala o serviço
console.log('\n═══════════════════════════════════════════════════════════');
console.log('   INSTALANDO SERVIÇO WINDOWS');
console.log('═══════════════════════════════════════════════════════════\n');
console.log('Instalando "EquatorialAutoInvoice"...\n');

svc.install();
