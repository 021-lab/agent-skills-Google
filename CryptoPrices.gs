/**
 * CryptoPrices.gs
 * ------------------------------------------------------------------
 * Замена формулы, которая раньше использовала CryptoCompare
 * (min-api.cryptocompare.com) через кастомную функцию ImportJSON:
 *
 *   =if(I1=1, ImportJSON("https://min-api.cryptocompare.com/data/price
 *        ?fsym=USD&tsyms="&G2&"&api_key=...", "/"))
 *
 * CryptoCompare перестал отвечать (ключ истёк / эндпоинт закрыли),
 * поэтому цены теперь берутся с CoinGecko — бесплатный публичный API,
 * не требующий ключа для эндпоинта /simple/price.
 * https://www.coingecko.com/en/api/documentation
 *
 * Семантика сохранена ТОЧНО как в оригинале:
 *   fsym  — базовая валюта (по умолчанию "USD"),
 *   tsyms — список тикеров через запятую (напр. "BTC,ETH,SOL"),
 *   результат — сколько единиц каждого tsym эквивалентно 1 fsym
 *   (то есть 1 / курс_тикера_в_fsym), одной строкой, "растекающейся"
 *   по столбцам — как это делал ImportJSON.
 *
 * Использование в таблице (было):
 *   =if(I1=1, ImportJSON("...&tsyms="&G2&"...", "/"))
 * Использование теперь:
 *   =IF(I1=1, CRYPTOCOMPARE_PRICE(G2))
 *   или, если нужна другая базовая валюта:
 *   =IF(I1=1, CRYPTOCOMPARE_PRICE(G2, "EUR"))
 * ------------------------------------------------------------------
 */

var COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';

/**
 * Точный аналог старой формулы на CryptoCompare.
 * Возвращает, сколько единиц каждого тикера из tsyms эквивалентно
 * 1 единице fsym (по умолчанию USD) — то есть то же самое число,
 * что раньше отдавал CryptoCompare для fsym=USD&tsyms=<tickers>.
 *
 * @param {string} tsyms Тикеры через запятую, напр. "BTC,ETH,SOL".
 * @param {string} fsym  Базовая валюта, по умолчанию "USD".
 * @return {Array<Array<number|string>>} Одна строка значений в том
 *         же порядке, что и tsyms; #N/A для тикеров, которые не
 *         удалось найти или получить цену.
 * @customfunction
 */
function CRYPTOCOMPARE_PRICE(tsyms, fsym) {
  if (tsyms === undefined || tsyms === null || tsyms === '') {
    throw new Error('Не указан список тикеров (tsyms)');
  }

  fsym = (fsym || 'USD').toString().trim().toUpperCase();
  var vsCurrency = fsym.toLowerCase();

  var tickers = tsyms
    .toString()
    .split(',')
    .map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return s.length > 0; });

  if (tickers.length === 0) {
    throw new Error('Список тикеров пуст');
  }

  var ids = tickers.map(resolveCoinGeckoId_);
  var uniqueIds = ids.filter(function (id, i) {
    return id && ids.indexOf(id) === i;
  });

  if (uniqueIds.length === 0) {
    return [tickers.map(function () { return '#N/A'; })];
  }

  var url = COINGECKO_BASE_URL + '/simple/price'
    + '?ids=' + encodeURIComponent(uniqueIds.join(','))
    + '&vs_currencies=' + encodeURIComponent(vsCurrency);

  var data = fetchJson_(url);

  var row = tickers.map(function (ticker, i) {
    var id = ids[i];
    var entry = id && data[id];
    var priceInFsym = entry && entry[vsCurrency];
    if (!priceInFsym || priceInFsym <= 0) {
      return '#N/A';
    }
    // CryptoCompare с fsym=USD&tsyms=X отдавал "сколько X за 1 USD",
    // то есть обратную величину курса X->USD.
    return 1 / priceInFsym;
  });

  return [row];
}

/**
 * Более привычный вариант: курс каждого тикера В базовой валюте
 * (напр. сколько USD стоит 1 BTC). Не было в оригинальной формуле,
 * но многим он и нужен на практике — оставлен как удобный бонус.
 *
 * @param {string} tsyms Тикеры через запятую, напр. "BTC,ETH,SOL".
 * @param {string} fsym  Валюта котировки, по умолчанию "USD".
 * @return {Array<Array<number|string>>} Одна строка курсов tsym->fsym.
 * @customfunction
 */
function CRYPTO_PRICE(tsyms, fsym) {
  var inverted = CRYPTOCOMPARE_PRICE(tsyms, fsym)[0];
  var row = inverted.map(function (v) {
    return (typeof v === 'number' && v > 0) ? 1 / v : '#N/A';
  });
  return [row];
}

/**
 * Переводит тикер (BTC, ETH, ...) в id CoinGecko (bitcoin, ethereum, ...).
 * Сначала проверяет статичную карту частых тикеров (без сетевого
 * запроса), затем при необходимости — полный список монет CoinGecko,
 * закешированный в CacheService на 12 часов.
 *
 * @param {string} ticker Тикер в верхнем регистре, напр. "BTC".
 * @return {string|null} id монеты в CoinGecko или null, если не найден.
 */
function resolveCoinGeckoId_(ticker) {
  var staticMap = getStaticTickerMap_();
  if (staticMap[ticker]) {
    return staticMap[ticker];
  }

  var dynamicMap = getDynamicTickerMap_();
  return dynamicMap[ticker] || null;
}

/**
 * Частые тикеры — захардкожены, чтобы не делать лишний запрос
 * к /coins/list на каждый чих. При коллизии тикера между несколькими
 * монетами берётся самая известная (напр. BTC -> bitcoin, а не
 * какой-нибудь форк).
 */
function getStaticTickerMap_() {
  return {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'BNB': 'binancecoin',
    'SOL': 'solana',
    'USDC': 'usd-coin',
    'XRP': 'ripple',
    'DOGE': 'dogecoin',
    'ADA': 'cardano',
    'TRX': 'tron',
    'TON': 'the-open-network',
    'AVAX': 'avalanche-2',
    'SHIB': 'shiba-inu',
    'DOT': 'polkadot',
    'LINK': 'chainlink',
    'MATIC': 'matic-network',
    'POL': 'polygon-ecosystem-token',
    'LTC': 'litecoin',
    'BCH': 'bitcoin-cash',
    'UNI': 'uniswap',
    'ATOM': 'cosmos',
    'XLM': 'stellar',
    'ETC': 'ethereum-classic',
    'FIL': 'filecoin',
    'APT': 'aptos',
    'NEAR': 'near',
    'ARB': 'arbitrum',
    'OP': 'optimism',
    'XMR': 'monero',
    'ALGO': 'algorand',
    'VET': 'vechain',
    'AAVE': 'aave',
    'SAND': 'the-sandbox',
    'MANA': 'decentraland',
    'EOS': 'eos',
    'XTZ': 'tezos',
    'THETA': 'theta-token',
    'AXS': 'axie-infinity',
    'FTM': 'fantom',
    'RUNE': 'thorchain',
    'GRT': 'the-graph',
    'CAKE': 'pancakeswap-token',
    'KCS': 'kucoin-shares',
    'ZEC': 'zcash',
    'DASH': 'dash',
    'NEO': 'neo',
    'IOTA': 'iota',
    'MKR': 'maker',
    'COMP': 'compound-governance-token',
    'SNX': 'havven',
    'CRV': 'curve-dao-token'
  };
}

/**
 * Полный список тикер -> id, загруженный с CoinGecko /coins/list
 * и закешированный в CacheService (макс. время жизни кэша — 6 часов,
 * поэтому обновляем каждые ~6 часов, что покрывает суточный лимит
 * бесплатного API).
 */
function getDynamicTickerMap_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('COINGECKO_TICKER_MAP');
  if (cached) {
    return JSON.parse(cached);
  }

  var list = fetchJson_(COINGECKO_BASE_URL + '/coins/list');
  var map = {};
  // Если тикер встречается у нескольких монет, оставляем первую
  // встреченную (обычно это самая старая / самая известная запись).
  list.forEach(function (coin) {
    var symbol = (coin.symbol || '').toUpperCase();
    if (symbol && !map[symbol]) {
      map[symbol] = coin.id;
    }
  });

  // CacheService ограничивает значение 100 КБ — список монет CoinGecko
  // крупнее, поэтому режем его до используемых нами полей и, если
  // всё равно не влезает, кэш просто не сохраняем (не критично).
  try {
    cache.put('COINGECKO_TICKER_MAP', JSON.stringify(map), 21600); // 6 часов
  } catch (e) {
    // Кэш не обязателен для корректной работы — просто теряем ускорение.
  }

  return map;
}

/**
 * Общая обёртка над UrlFetchApp с проверкой кода ответа и понятной
 * ошибкой вместо тихого падения формулы с "#ERROR!" без контекста.
 *
 * @param {string} url
 * @return {Object} Разобранный JSON-ответ.
 */
function fetchJson_(url) {
  var response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    method: 'get'
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error(
      'Запрос к CoinGecko не удался (HTTP ' + code + '): '
      + response.getContentText()
    );
  }

  return JSON.parse(response.getContentText());
}
