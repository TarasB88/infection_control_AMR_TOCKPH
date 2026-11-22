import { pbkdf2Sync, randomBytes } from 'node:crypto';

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error('Запустіть скрипт у звичайному інтерактивному терміналі.');
  process.exit(1);
}

const input = process.stdin;
let password = '';
process.stdout.write('Введіть початковий пароль (мінімум 12 символів; введення приховане): ');
input.setRawMode(true);
input.setEncoding('utf8');
input.resume();
input.on('data', (chunk) => {
  for (const char of chunk) {
    if (char === '\u0003') {
      process.stdout.write('\nСкасовано.\n');
      process.exit(1);
    }
    if (char === '\r' || char === '\n') {
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (password.length < 12 || password.length > 128) {
        password = '';
        console.error('Пароль має містити від 12 до 128 символів.');
        process.exit(1);
      }
      const salt = randomBytes(16);
      const hash = pbkdf2Sync(password, salt, 310000, 32, 'sha256');
      process.stdout.write('Password_Hash:\n');
      process.stdout.write('pbkdf2-sha256$310000$' + salt.toString('base64url') + '$' + hash.toString('base64url') + '\n');
      password = '';
      process.exit(0);
    }
    if (char === '\u007f' || char === '\b') {
      password = password.slice(0, -1);
    } else if (char >= ' ') {
      password += char;
    }
  }
});
