// JSON calls to the server. A 401 hands over to the sign-in screen.

let onSignedOut = () => {};
export const whenSignedOut = (fn) => { onSignedOut = fn; };

export async function api(method, path, body) {
  let r;
  try {
    r = await fetch('api' + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new Error('No connection to the server');
  }
  const data = await r.json().catch(() => null);
  if (r.status === 401 && path !== '/login') {
    onSignedOut();
    throw new Error('Not signed in');
  }
  if (!r.ok) throw new Error(data?.error || `Server error (${r.status})`);
  return data;
}
