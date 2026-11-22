import { createInterface } from 'node:readline';
import { randomBytes, pbkdf2Sync } from 'node:crypto';

if (!process.stdin.isTTY) {
  console.error('Запустіть скрипт у звичайному інтерактивному терміналі.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Введіть початковий пароль (мінімум 12 символів): ', (password) => {
  rl.close();
  if (password.length < 12 || password.length > 128) {
    console.error('Пароль має містити від 12 до 128 символів.');
    process.exit(1);
  }
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
  console.log('\nPassword_Hash:');
  console.log('pbkdf2-sha256$310000$' + salt.toString('base64url') + '$' + hash.toString('base64url'));
});
