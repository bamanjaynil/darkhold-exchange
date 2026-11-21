async function verifyVite() {
  const html = await fetch('http://localhost:5173/').then(r => r.text());
  console.log('Vite index.html size:', html.length, 'Contains root:', html.includes('id="root"'));

  const health = await fetch('http://localhost:5173/api/health').then(r => r.json());
  console.log('Vite proxy health:', health);

  const insts = await fetch('http://localhost:5173/api/instruments').then(r => r.json());
  console.log('Vite proxy instruments count:', insts.length);

  const loginRes = await fetch('http://localhost:5173/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'demo_darkhold_2026' })
  });
  console.log('Login status via Vite:', loginRes.status);
  const cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  console.log('Cookies received:', cookies);

  const meRes = await fetch('http://localhost:5173/api/auth/me', {
    headers: { 'Cookie': cookies }
  });
  console.log('Me status via Vite:', meRes.status);

  const holdingsRes = await fetch('http://localhost:5173/api/wallet/holdings', {
    headers: { 'Cookie': cookies }
  });
  console.log('Holdings via Vite:', await holdingsRes.json());

  const logoutRes = await fetch('http://localhost:5173/api/auth/logout', {
    method: 'POST',
    headers: { 'Cookie': cookies }
  });
  console.log('Logout status via Vite:', logoutRes.status);
  console.log('Logout Set-Cookie:', logoutRes.headers.getSetCookie());

  const meAfter = await fetch('http://localhost:5173/api/auth/me', {
    headers: { 'Cookie': cookies }
  });
  console.log('Me after logout status:', meAfter.status);
  if (meAfter.status === 401) {
    console.log('SUCCESS: Session completely cleared and verified via Vite proxy!');
  } else {
    throw new Error('Expected 401 after logout but got: ' + meAfter.status);
  }
}
verifyVite().catch(err => {
  console.error(err);
  process.exit(1);
});
