import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApartPrices } from '../scripts/collect-apart.mjs';

const quote = `Aktualny kurs złota: 515.09 zł/g
Data aktualizacji kursu: 2026-10-28 17:02
Bestsellery
C-Hafner Sztabka 1 oz (24h) 16 500 PLN
Tabela cen skupu
ZŁOTE MONETY
Amerykański Orzeł 1oz 16135.00 zł
ZŁOTE SZTABKI
C-Hafner Sztabka 0,5 g | 269.00 zł
C-Hafner Sztabka 1 oz | 15735.00 zł
C-Hafner Sztabka 1 oz - odlewana | 15735.00 zł
C-Hafner Sztabka 25 g | 12431.00 zł
SREBRNE SZTABKI
Srebrna Sztabka 1oz KGHM | 300.00 zł`;

test('czyta ceny skupu, nie sprzedaży', () => {
  assert.deepEqual(parseApartPrices(quote), {
    sourceUpdatedAt: '2026-10-28T17:02:00',
    products: { cHafner1oz: 15735, cHafner25g: 12431 }
  });
});

test('czyta HTML z tagami tabel', () => {
  const html = `<html><body><div>Data aktualizacji kursu: 2026-10-28 17:02</div>
    <h2>Tabela cen skupu</h2><h3>ZŁOTE SZTABKI</h3><table>
    <tr><td>C-Hafner Sztabka 1 oz</td><td>15735.00 zł</td></tr>
    <tr><td>C-Hafner Sztabka 25 g</td><td>12431.00 zł</td></tr>
    </table><h3>SREBRNE SZTABKI</h3></body></html>`;
  assert.equal(parseApartPrices(html).products.cHafner1oz, 15735);
});

test('odrzuca cenę sprzedaży, gdy brak tabeli skupu', () => {
  assert.throws(() => parseApartPrices('Data aktualizacji kursu: 2026-10-28 17:02\nC-Hafner Sztabka 1 oz 16400 zł'), /Tabela cen skupu/);
});

test('odrzuca błędne proporcje', () => {
  assert.throws(() => parseApartPrices(quote.replace('12431.00 zł', '9000.00 zł')), /proporcja cen skupu/);
});
