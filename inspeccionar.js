// inspeccionar.js — Compara dos artículos de Alegra (uno marcado "mostrar en
// tienda" y otro no) y muestra los campos en que difieren, para descubrir
// cómo se llama ese campo en la API.
// NO imprime datos sensibles: excluye costos y valores de listas de precios.

const ID_A = process.env.ITEM_A; // artículo CON "mostrar en tienda"
const ID_B = process.env.ITEM_B; // artículo SIN "mostrar en tienda"

const SENSIBLES = ['unitCost', 'initialQuantity', 'price', 'ledger', 'tax'];

function limpiar(obj) {
  if (Array.isArray(obj)) return obj.map(limpiar);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSIBLES.includes(k)) {
        out[k] = '[omitido]';
      } else {
        out[k] = limpiar(v);
      }
    }
    return out;
  }
  return obj;
}

async function traer(id, auth) {
  const res = await fetch(`https://api.alegra.com/api/v1/items/${id}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Alegra respondió ${res.status} para el item ${id}`);
  return res.json();
}

async function main() {
  const email = process.env.ALEGRA_EMAIL;
  const token = process.env.ALEGRA_TOKEN;
  if (!email || !token) throw new Error('Faltan los secrets de Alegra');
  if (!ID_A || !ID_B) throw new Error('Faltan los IDs de los artículos a comparar');
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;

  const a = limpiar(await traer(ID_A, auth));
  await new Promise((r) => setTimeout(r, 1500));
  const b = limpiar(await traer(ID_B, auth));

  console.log(`\n=== Campos del artículo ${ID_A} (visible en tienda): ===`);
  console.log(Object.keys(a).sort().join(', '));

  console.log(`\n=== Diferencias entre ${ID_A} (visible) y ${ID_B} (oculto): ===`);
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  let huboDiferencias = false;
  for (const k of [...claves].sort()) {
    const va = JSON.stringify(a[k]);
    const vb = JSON.stringify(b[k]);
    if (va !== vb && !['name', 'description', 'id', 'reference', 'images', 'inventory', 'itemCategory', 'category'].includes(k)) {
      huboDiferencias = true;
      console.log(`\nCampo "${k}":`);
      console.log(`  visible: ${va}`);
      console.log(`  oculto:  ${vb}`);
    }
  }
  if (!huboDiferencias) {
    console.log('No hay diferencias en campos candidatos. Artículo visible completo:');
    console.log(JSON.stringify(a, null, 2));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
