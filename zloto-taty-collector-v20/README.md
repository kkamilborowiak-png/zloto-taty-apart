# Złoto Taty – niezależny kolektor cen skupu Apartu (V20)

Ta paczka **nie jest** deploymentem Cloudflare Pages. Jest osobnym repozytorium
GitHub Actions, które cyklicznie próbuje pobrać publiczną stronę
https://mennica.apart.pl/skup przez serwery GitHuba, odczytać **ceny skupu**
C-Hafner 1 oz i 25 g oraz przesłać je do prywatnego endpointu Cloudflare.

Nie ma gwarancji, że GitHub może pobierać Apart. Jeśli Apart zablokuje również
adresy IP GitHuba (HTTP 403), to trzeba uzyskać dostęp od Mennicy Apart, np.
API lub whitelistę. Kolektor **nie obchodzi logowania/CAPTCHA** i nie używa
publicznych anonimowych proxy.

## Instrukcja instalacji krok po kroku

### 1. Wgraj nową apkę do Cloudflare

Wgraj osobną paczkę `zloto-taty-deploy-v20.zip` do projektu Pages `tata-zloto`
na https://dash.cloudflare.com/ (Deployments > Upload assets). W ZIP są pliki
strony w katalogu głównym: `index.html`, `_worker.js`, `app.js` itd.

### 2. Utwórz Cloudflare KV

W Cloudflare utwórz KV namespace np. `zloto-taty-prices`.
W projekcie Workers & Pages > `tata-zloto` > Settings > Bindings dodaj namespace KV
pod nazwą zmiennej **PRICES_KV**, wybierając nowy namespace. W Settings >
Variables and Secrets dodaj sekret **ADMIN_TOKEN** (długi losowy ciąg,
minimum 32 znaki; zapisz go sobie do konfiguracji GitHuba). Dodaj oba do
środowiska produkcyjnego. Może być potrzebne ponowne wdrożenie projektu.

Jeśli zrobiłeś to już przy V19, użyj dotychczasowego KV i sekretu – nie twórz
nowych.

Otwórz https://tata-zloto.pages.dev/api/feed-status . W polu `configured`
ma być `true`.

### 3. Załóż repozytorium GitHub

Na https://github.com/new utwórz nowe repozytorium np. `zloto-taty-apart`.
Repozytorium może być publiczne: kod zawiera tylko adres publicznego cennika,
żadnych sekretów ani danych osobowych. Publiczne repo może być korzystniejsze
ze względu na limity bezpłatnych minut GitHub Actions; sprawdź aktualne
warunki swojego konta.

Wgraj do **głównego katalogu** repozytorium:
- `scripts/collect-apart.mjs`
- `package.json`
- `.github/workflows/collect-apart.yml` (ścieżka ma zaczynać się od kropki)

Nie wgrywaj ZIP-a jako jednego pliku. Rozpakuj i dodaj pliki z zachowaniem
struktury folderów. Jeśli panel GitHuba nie pozwoli wgrać ukrytego katalogu
`.github`, wybierz Add file > Create new file i wpisz jako nazwę
`.github/workflows/collect-apart.yml`, a potem wklej zawartość z paczki.

### 4. Skonfiguruj sekret w GitHub Actions

Repozytorium > Settings > Secrets and variables > Actions > New repository secret:
- Name: `ADMIN_TOKEN`
- Secret: dokładnie ten sam losowy ciąg co w Cloudflare Pages.

Możesz też ustawić opcjonalną repository variable `GOLD_API_URL` na
`https://tata-zloto.pages.dev/api/collector-prices`; przy braku zmiennej
kolektor używa tego adresu domyślnie.

### 5. Pierwszy test

Repozytorium > Actions > `Automatyczny cennik skupu Mennicy Apart` >
Run workflow > Run workflow. Otwórz log zakończonego uruchomienia.

- Sukces: `Wspólny cennik został zaktualizowany`.
- HTTP 401: sekrety ADMIN_TOKEN w GitHub i Cloudflare różnią się.
- HTTP 501: nie ma PRICES_KV lub ADMIN_TOKEN w Cloudflare.
- HTTP 403 od Apartu: serwery GitHub też są blokowane; potrzebna zgoda / dostęp.
- Brak tabeli: strona zmieniła HTML lub zablokowała odczyt.

Następnie otwórz:
https://tata-zloto.pages.dev/api/feed-status

`collector.found` powinno mieć wartość `true`, a `sourceUpdatedAt` aktualną
godzinę oficjalnego cennika. Na obu telefonach naciśnij **Odśwież ceny**.

### 6. Automatyczne działanie

GitHub Actions ma harmonogram `4,14,24,34,44,54 * * * *`, czyli 6 razy
na godzinę. GitHub **nie gwarantuje punktualnego uruchamiania** zadań
harmonogramu. Gdy kolektor zawiedzie, aplikacja nadal pokaże ostatnią
prawidłową cenę ze znacznikiem czasu. W weekend mogą nie pojawiać się nowe
notowania.

Historia portfela i rekord na obu telefonach nadal są lokalne – automatyczna
synchronizacja dotyczy wyłącznie wspólnego, najnowszego cennika.
