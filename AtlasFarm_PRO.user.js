// ==UserScript==
// @name         AtlasFarm PRO (nieoficjalny)
// @namespace    atlasfarm.pro.license.v1
// @version      1.2.0
// @description  Nieoficjalny menedżer EXP, tras i handlu z licencją; wymaga zgodności z regulaminem gry.
// @match        https://*.margonem.pl/*
// @match        https://*.margonem.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @license      Proprietary - warunki określa sprzedawca
// @updateURL    https://raw.githubusercontent.com/pawelkot402-glitch/AtlasFarm-PRO/main/AtlasFarm_PRO.user.js
// @downloadURL  https://raw.githubusercontent.com/pawelkot402-glitch/AtlasFarm-PRO/main/AtlasFarm_PRO.user.js
// ==/UserScript==
/*
  v48: Jeden sterownik, bez konkurujących pętli podróży i walki.
  Dane MargoWorld pobrane 29.10.2026: 2785 nazw map, 111 expowisk;
  610 zwykłych NPC z pliku archiwalnego + 2 uzupełnienia z publicznych stron.
  Nie jest kompletnym grafem wszystkich bramek; ignoruje niepotwierdzone trasy.
  Jako skrypt w konsoli działa do przeładowania strony; jako Tampermonkey
  może odtworzyć stan START po pełnym przeładowaniu.
  Bez kontroli zdrowia i leczenia. Handel automatyczny wymaga potwierdzenia w kliencie gry.
*/

/*
  Wersja sprzedażowa AtlasFarm PRO 1.2.0, silnik Multi-Farm 61.9.1.
  Wersje AtlasFarm PRO 1.0.0 i 1.1.0 aktualizują się bez utraty klucza.
  Oryginalny Multi-Farm ma osobny identyfikator; wyłącz go, aby uniknąć konfliktów.
  v61.1: Tunia Frupotius, zweryfikowany identyfikator NPC na mapie 353,
  nowe selektory odpowiedzi dialogowych i limit prób rozmowy.
  v61: zapis atlasu z debounce, pamięć podręczna tras, wygaśnięcie blokad,
  kontrola koszyków przed zatwierdzeniem transakcji, stan po restarcie,
  opcje automatu, przeciągany panel i diagnostyka błędów.
  UWAGA: integracja z grą wymaga sprawdzenia na żywym koncie; gra może
  zmieniać API i DOM. Automatyczny handel może wiązać się z ryzykiem.
*/
(() => {
  'use strict';
  const ROOT = window;
  // Zapamiętaj stan PRZED wyłączeniem poprzedniej instancji. Jej stop()
  // może wyczyścić flagę zapisanej sesji przy ponownym wstrzyknięciu kodu.
  let wasRunningBeforeReplace = false;
  try { wasRunningBeforeReplace = !!ROOT.MF54?.state?.running; } catch {}
  try { ROOT.MF61?.destroy?.({preserveRunning:true}); } catch {}
  try { ROOT.MF54?.destroy?.({preserveRunning:true}); } catch {}
  // Wyłącz pozostałości wcześniejszych wersji, aby druga pętla nie przenosiła postaci.
  try { ROOT.margonemHelper?.destroy?.(); } catch (e) { console.warn('[MF54] Stary helper:',e); }
  if (typeof document !== 'undefined') {
    for (const id of ['margonem-helper-panel','mf-travel-panel','mf-explorer-panel','mf54-panel','mf61-panel']) {
      try { document.getElementById(id)?.remove(); } catch {}
    }
  }
  // v61.9.1: zakup zwojów teleportacji jednorazowo jako pakiet pięciu sztuk.
  // v61.9.0: automatyczne zamknięcie sklepu i potwierdzenie zamknięcia przed powrotem na EXP.
  // v61.7.0: naprawiono osierocone koszyki po restarcie, akceptację sprzedaży,
  // odzyskiwanie transakcji, przejście do zakupów i kontrolę typu przedmiotów.
  // Poprzednia poprawka: nie uznajemy przesunięcia do koszyka za sprzedaż.
  // Stabilne rozliczenie, ostrożny retry zatwierdzenia i zakup mikstur.
  // v61.4.0: Tunia: naprawa wyboru przedmiotów z plecaka, retry, skip, koszyki.
  // v61.3.0: Tunia: wspólny sterownik sklepu, akceptacja transakcji,
  // weryfikacja ekwipunku, dialog oraz przeglądanie trzech toreb.
  const VERSION = '61.9.1';
  const PRODUCT_NAME = 'AtlasFarm PRO';
  const PRODUCT_VERSION = '1.2.0';
  // AtlasFarm PRO: weryfikacja podpisanego klucza bez serwera.
  // W skrypcie klienta jest TYLKO KLUCZ PUBLICZNY. Klucz prywatny zostaje u sprzedawcy.
  const LICENSE_STORAGE_KEY='AFPRO_LICENSE_V1';
  const LICENSE_PUBLIC_KEY_SPKI='MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEY01jt7vHki+/Z9LEjOyRbq0xzOvAtSGwJkHjLXNqLGhgETc8fDL5304QNlBF1N9zUC8sU/1qVv5Ykgii7gQqLg==';
  const LICENSE_PRODUCT='atlasfarm-pro';
  const license={checked:false,valid:false,details:null,message:'Sprawdzam licencję...',requestId:0};
  let licenseStatusEl=null,licenseInputEl=null,licenseActivateButton=null,licenseStartButton=null;
  const licenseExpiryMs=()=>license.details?.expiresAt ? Date.parse(license.details.expiresAt) : Infinity;
  const licenseActive=()=>license.checked && license.valid && Date.now()<licenseExpiryMs();
  function refreshLicenseDisplay(){
    if(licenseStatusEl){
      const expires=license.details?.expiresAt ? new Date(license.details.expiresAt).toLocaleDateString('pl-PL') : 'bezterminowo';
      licenseStatusEl.textContent=licenseActive()
        ? '✓ Licencja aktywna · '+String(license.details.licenseId)+' · ważna do: '+expires
        : '🔒 '+(license.valid ? 'Licencja wygasła.' : license.message);
      licenseStatusEl.style.color=licenseActive()?'#98edb1':'#f1c27d';
    }
    if(licenseStartButton)licenseStartButton.disabled=!licenseActive();
    if(licenseStartButton)licenseStartButton.style.opacity=licenseActive()?'1':'.55';
    if(licenseActivateButton)licenseActivateButton.disabled=!license.checked;
  }
  function base64urlDecode(text){
    if(!/^[A-Za-z0-9_-]+$/.test(text)||text.length>4096)throw Error('Niepoprawny format klucza.');
    const normalized=text.replace(/-/g,'+').replace(/_/g,'/');
    const decoded=atob(normalized+'='.repeat((4-normalized.length%4)%4));
    return Uint8Array.from(decoded,ch=>ch.charCodeAt(0));
  }
  async function verifyLicense(raw){
    if(!globalThis.crypto?.subtle)throw Error('Przeglądarka nie obsługuje bezpiecznej weryfikacji licencji.');
    const compact=String(raw||'').replace(/\s+/g,'');
    if(compact.length>4096)throw Error('Zbyt długi klucz.');
    const parts=compact.split('.');
    if(parts.length!==3||parts[0]!=='AFPRO1')throw Error('To nie jest klucz AtlasFarm PRO.');
    const data=base64urlDecode(parts[1]);
    const signature=base64urlDecode(parts[2]);
    if(signature.length!==64||data.length>2000)throw Error('Niepoprawny rozmiar podpisu lub danych.');
    const publicKey=await crypto.subtle.importKey('spki',
      Uint8Array.from(atob(LICENSE_PUBLIC_KEY_SPKI),ch=>ch.charCodeAt(0)),
      {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,data)){
      throw Error('Nieprawidłowy podpis licencji.');
    }
    const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    if(!decoded||decoded.product!==LICENSE_PRODUCT||decoded.edition!=='PRO'||
       !/^[A-Z0-9-]{6,64}$/.test(String(decoded.licenseId||''))||
       typeof decoded.issuedAt!=='string' || !Number.isFinite(Date.parse(decoded.issuedAt))){
      throw Error('Klucz nie jest przeznaczony do tego produktu.');
    }
    if(Date.parse(decoded.issuedAt)>Date.now()+86400000)throw Error('Data wystawienia licencji jest w przyszłości.');
    if(decoded.expiresAt!==null && (typeof decoded.expiresAt!=='string' ||
       !Number.isFinite(Date.parse(decoded.expiresAt))))throw Error('Niepoprawny termin ważności.');
    if(decoded.expiresAt && Date.now()>=Date.parse(decoded.expiresAt))throw Error('Licencja wygasła.');
    return {licenseId:decoded.licenseId,expiresAt:decoded.expiresAt,edition:'PRO'};
  }
  async function activateLicense(raw,store=true){
    const requestId=++license.requestId;
    license.checked=false;license.valid=false;license.details=null;
    license.message='Weryfikacja podpisu...';
    if(state.running)stop();
    refreshLicenseDisplay();
    try{
      const info=await verifyLicense(raw);
      if(requestId!==license.requestId)return false;
      license.checked=true;license.valid=true;license.details=info;
      license.message='Aktywna';
      if(store){
        try{localStorage.setItem(LICENSE_STORAGE_KEY,String(raw).replace(/\s+/g,''));}
        catch {license.message='Aktywna (nie można zapisać klucza w przeglądarce).';}
      }
      refreshLicenseDisplay();
      status('Licencja aktywowana. Możesz użyć START.','LICENCJA');
      return true;
    }catch(error){
      if(requestId!==license.requestId)return false;
      license.checked=true;license.valid=false;license.details=null;
      license.message=String(error?.message||error);
      if(store)try{localStorage.removeItem(LICENSE_STORAGE_KEY);}catch{}
      refreshLicenseDisplay();
      status(license.message,'LICENCJA');
      return false;
    }
  }
  function removeLicense(){
    ++license.requestId;
    if(state.running)stop();
    try{localStorage.removeItem(LICENSE_STORAGE_KEY);}catch{}
    license.checked=true;license.valid=false;license.details=null;
    license.message='Brak licencji. Wklej klucz otrzymany od sprzedawcy.';
    if(licenseInputEl)licenseInputEl.value='';
    refreshLicenseDisplay();
    status(license.message,'LICENCJA');
  }
  async function initLicense(){
    let savedKey='';
    try{savedKey=localStorage.getItem(LICENSE_STORAGE_KEY)||'';}catch{}
    if(!savedKey){
      license.checked=true;
      license.message='Brak licencji. Wklej klucz otrzymany od sprzedawcy.';
      refreshLicenseDisplay();
      status(license.message,'LICENCJA');
      return;
    }
    const ok=await activateLicense(savedKey,false);
    if(ok && (saved.running===true||wasRunningBeforeReplace)){
      start();status('Wznowiono poprzednią sesję po weryfikacji licencji.','START');
    }
  }
  const STORE_ATLAS = 'MF48_ATLAS_v1';
  const STORE_CONFIG = 'MF48_CONFIG_v1';
  const STORE_SCROLL_LOCKS = 'MF61_SCROLL_PURCHASE_LOCKS_v1';
  const STORE_EXPLORE = 'MF54_EXPLORE_v1';
  const TICK_MS = 300;
  const MAX_CONSECUTIVE_TICK_ERRORS = 5;
  const MAP_NAMES = {"1":"Ithan","10":"Przełęcz Dwóch Koron","100":"Dom Remiusza","1000":"Pokój 2","1001":"Pokój 3","1002":"Pokój 4","1003":"Pokój 5","1004":"Pokój 6","1005":"Pokój 7","1006":"Pokój 8","1007":"Pokój 9","1008":"Zajazd pod Tęczowym Żukiem p.2","1009":"Pokój 10","101":"Przeklęta Pieczara p.1","1010":"Pokój 11","1011":"Pokój 12","1012":"Pokój 13","1013":"Pokój 14","1014":"Pokój 15","1015":"Pokój 16","1016":"Pokój 17","1017":"Pokój 18","1018":"Pokój 19","1019":"Pokój 20","102":"Przeklęta Pieczara p.2","1020":"Izba 25","1021":"Ratusz Nithal","1022":"Ratusz Nithal - muzeum p.1","1023":"Ratusz Nithal - muzeum p.2","1024":"Ratusz Nithal - skarbiec","1025":"Ratusz Nithal - gabinet burmistrza","1026":"Magazyn win p.1","103":"Dom Roszana","1032":"Komnata 104","1033":"Komnata 105","1034":"Komnata 106","1035":"Komnata 111","1036":"Komnata 112","1037":"Komnata 113","1038":"Apartament 101","1039":"Apartament 202","104":"Dom Kaliposa","1040":"Apartament 205","1041":"Apartament 302","1043":"Apartament 307","1044":"Apartament 309","1045":"Apartament 305","1047":"Baszta p.2","1048":"Baszta p.1","1049":"Baszta","105":"Dom Kalicji i Apoksa","1051":"Grota pod Basztą","1054":"Przejście astronoma","1057":"Skalista Wyżyna","1058":"Ustronie Widzących Drzew","106":"Pracownia Inetora","1060":"Kryjówka Dzikich Kotów","1062":"Wilczy Szpic","1064":"Wóz Vadomy","1066":"Wóz starego Fonsa i Perhany","1067":"Ratusz Thuzal","1068":"Ratusz Thuzal - sala bankietowa","1069":"Ratusz Thuzal - sala dzwonów","107":"Dom Hergata i Halfinii","1071":"Wóz kapeli","108":"Dom Hergata i Halfinii p.1","1082":"Wóz Alizy i Thorna","1084":"Święty Zagajnik","109":"Dom Anzelma","1090":"Wóz Ksenii i Brunona","1091":"Chata Letanii i Flaviusa","1092":"Domek Enyi","1095":"Chata Multinii i Szeptusa","1096":"Chata Fanii i Arheniusa","1099":"Kaplica Światłości","11":"Dolina Yss","110":"Dolina Rozbójników","1104":"Opuszczona Twierdza","1105":"Czarcie Oparzeliska","1106":"Grobowiec Przodków","1107":"Zaginiona Dolina","1108":"Leśna Przełęcz","111":"Ghuli Mogilnik","1111":"Zapomniany Las","1115":"Rozległa Równina","1116":"Głuchy Las","1117":"Dom Wazira","1118":"Dom Wazira p.1","1119":"Dom Wazira - piwnica","112":"Zapomniany Grobowiec p.1","1120":"Dom Rumiry i Dobromira","1121":"Dom Rumiry i Dobromira p.1","1122":"Dom Rumiry i Dobromira - piwnica","1123":"Sklep z winem","1124":"Sklep z winem - piwnica p.1","1125":"Sklep z winem - piwnica p.2","1126":"MAPKI EVENTOWE","113":"Dom Remiusza - piwnica","1130":"Jaskinia Lodowego Czaru","1131":"Pajęczy Las","1132":"Arachnitopia p.1","1136":"Arachnitopia p.2","1137":"Księżycowe Wzniesienie","1138":"Arachnitopia p.3","1139":"Zakon Białej Lilii - katakumby","114":"Thuzal","1140":"Arachnitopia p.4","1141":"Trupia Przełęcz","1142":"Arachnitopia p.5","1144":"Kamienna Strażnica - wsch. baszta p.2","1145":"Kamienna Strażnica - wsch. baszta p.1","1146":"Kamienna Strażnica - wsch. baszta skalna sala p.1","1147":"Kamienna Strażnica - wsch. baszta zasypany tunel","1148":"Kamienna Strażnica - wsch. baszta skalna sala p.0","1149":"Kamienna Strażnica - tunel","115":"Mokradła","1150":"Kamienna Strażnica - Sala Chwały","1151":"Kamienna Strażnica - Sanktuarium","1152":"Kamienna Strażnica - zach. baszta p.1","1153":"Kamienna Strażnica - zach. baszta p.2","1154":"Stare Sioło","1155":"Kamienica Kleofasa","1156":"Kamienica Kleofasa p.1","1157":"Gildia Kupców","1158":"Gildia Kupców p.1","1159":"Arachnitopia p.6","116":"Zburzona Twierdza","1166":"Kamienica Newalda","117":"Świszcząca Grota p.1","1172":"Dom Dereka i Karapo","1173":"Dom Dereka i Karapo p.1","1174":"Dom Dereka i Karapo - piwnica","1175":"Dom Trosa i Idai","1176":"Dom Trosa i Idai p.1","1177":"Dom Trosa i Idai - piwnica","1178":"Magazyn Trosa","1179":"Dom Sinis p.1","118":"Świszcząca Grota p.2","1180":"Dom Sinis","1181":"Dom Sericji i Callusa","1182":"Dom Sericji i Callusa p.1","1183":"Pracownia krawiecka Sericji i Callusa p.1","1184":"Pracownia krawiecka Sericji i Callusa","1185":"Dom Alfreda - piwnica","1186":"Magazyn z rybami Alfreda","1187":"Dom Alfreda","1188":"Dom Alfreda p.1","1189":"Dom Orfelii","119":"Świszcząca Grota p.3","1190":"Dom Orfelii p.1","1191":"Magazyn Orfelii","1192":"Zasypane Ograbar-dun","1193":"Firnowa Grota p.1","1197":"Szkoła - piwnica","1199":"Szkolna biblioteka","12":"Stare Ruiny","120":"Świszcząca Grota p.4","1200":"Kanciapa woźnego","1201":"Porzucone laboratorium","1202":"Wiedźmie Kotłowisko","1203":"Magazyn rybny","1204":"Firnowa Grota p.2","1205":"Dom Namianaszi","1206":"Dom Namianaszi p.1","1207":"Gospodarstwo Erdy","1208":"Gospodarstwo Erdy p.1","1209":"Dom Cynamonii","121":"Góry Zrębowe","1210":"Gospodarstwo Balko","1211":"Gospodarstwo Balko - piwnica","1212":"Magazyn rodziny Balko","1213":"Siedziba Straży Bramy","1214":"Siedziba Straży Bramy - loch","1215":"Siedziba Straży Bramy p.1","1217":"Pokład Szarej Mewy","1219":"Prastara Puszcza","122":"Nawiedzony Jar","1220":"Siedziba goblinów","1221":"Siedziba goblinów p.1","1222":"Siedziba goblinów - piwnica","1224":"Kuźnia Kendala","1225":"Skład Kendala","1226":"Kuźnia Kendala p.1","123":"Stare Wyrobisko p.1","1233":"Wioska Rybacka","1235":"Prochownia","124":"Stare Wyrobisko p.2","1240":"Gildia Magów","1241":"Gildia Magów - korytarz","1244":"Gildia Magów - pokój Olimpiodora","1245":"Chata Lomalandiego","1246":"Chata Króla Rybaka","1247":"Chata Króla Rybaka - piwnica","125":"Stare Wyrobisko p.3","126":"Stare Wyrobisko p.4","1262":"Latarniane Wybrzeże","1263":"Tygrysia Polana","1264":"Jaskinia Dzikich Kotów","1267":"Dzikie Pagórki","127":"Stare Wyrobisko p.5","1277":"Dom stajennego","1278":"Dom stajennego p.1","1279":"Stodoła","128":"Zachodnie Rozdroża","1280":"Stajnia","1281":"Magazyn","1282":"Dom latarnika","1283":"Dom latarnika p.1","1285":"Osada Mulusów","129":"Górska Grota p.1","1293":"Upiorna Droga","1294":"Sabatowe Góry","1297":"Tristam","1298":"Splądrowana kaplica","1299":"Ograbiona świątynia","13":"Dom sióstr","130":"Górska Grota p.2","1300":"Splugawiona kaplica","1301":"Dom Atalii","1302":"Opuszczone więzienie","1303":"Dom Amry","1304":"Dom nawiedzonej wiedźmy","1305":"Dom Adariel","1306":"Dom starej czarownicy","1307":"Dom czarnej magii","1308":"Magazyn mioteł","131":"Górska Kopalnia","1312":"Dom Keftii","1313":"Magistrat","1314":"Dom Keftii p.1","1315":"Lochy Tristam","1318":"Dom Erkora","1319":"Dom Erkora p.1","132":"Pieczara Wiatru p.1","1320":"Dom Erkora - piwnica","1322":"Laboratorium Adariel","1323":"Zapomniany Święty Gaj p.1","1324":"Zapomniany Święty Gaj p.2","1325":"Zapomniany Święty Gaj p.3","1326":"Dom Piwocji","1327":"Dom Piwocji p.1","1328":"Dom Piwocji - piwnica","1329":"Dom Hengadze","133":"Pieczara Wiatru p.2","1330":"Dom Hengadze p.1","1331":"Dom Rajwosa","1332":"Dom Rajwosa p.1","1333":"Tawerna pod Beczką Śledzi","1334":"Tawerna pod Beczką Śledzi p.1","1335":"Tawerna pod Beczką Śledzi - mieszkanie","1336":"Jaskinia Hoskarii","1337":"Korsarska Nora - sala 1","1338":"Korsarska Nora - sala 2","1339":"Korsarska Nora - sala 3","134":"Pieczara Wiatru p.3","1340":"Korsarska Nora - sala 4","1341":"Korsarska Nora - sala 5","1342":"Korsarska Nora - sala 6","1343":"Korsarska Nora - zachodni przełaz","1344":"Korsarska Nora - wschodni przełaz","1345":"Korsarska Nora - statek","135":"Przepastna Grota p.1","1352":"Piekielna Sala Ognia","1353":"Grota Samotnych Dusz p.1","1354":"Grota Samotnych Dusz p.2","1355":"Grota Samotnych Dusz p.3","1358":"Przybytek Bogini Wojny","1359":"Rozgrabione Ruiny - wieża","136":"Przepastna Grota p.2","1369":"Sierociniec","137":"Wioska Pszczelarzy","1370":"Sierociniec p.1","1371":"Sierociniec - kuchnia","1372":"Dom Zimpo","1373":"Dom Zimpo - strych","1374":"Dom Gopisa","1375":"Dom Gopisa - piwnica","1376":"Dom Patercji","1377":"Dom Patercji p.1","1378":"Dom Patercji - piwnica","1379":"Magazyn","138":"Porzucone Pasieki","1380":"Dom Jankerta","1381":"Dom Jankerta p.1","1382":"Dom Parmina","1383":"Tawerna pod Bosmańskim Biczem","1384":"Tawerna pod Bosmańskim Biczem - piwnica","1385":"Dom sir Glusmoronka","1386":"Dom sir Glusmoronka p.1","1387":"Skały Mroźnych Śpiewów","1388":"Tawerna pod Bosmańskim Biczem p.1","1389":"Tawerna pod Bosmańskim Biczem p.2","1390":"Stare lokum bandytów","1395":"Stare lokum bandytów p.1","1398":"Pokój 101","14":"Dom sióstr p.1","140":"Mroczny Przesmyk","1400":"Pokój 102","1401":"Pokój 103","1402":"Pokój 204","1403":"Pokój 205","1404":"Pokój 206","1405":"Dom Samiry","1406":"Dom Samiry p.1","1407":"Dom Samiry - piwnica","1408":"Dom Jankerta - piwnica","1409":"Dom kaletnika Jędrzeja","141":"Mroczna Pieczara p.1 - sala 1","1410":"Dom kaletnika Jędrzeja p.1","1411":"Dom kaletnika Jędrzeja - piwnica","1412":"Siedziba Straży Portowej - zbrojownia","1413":"Siedziba Straży Portowej","1414":"Siedziba Straży Portowej p.1","1415":"Dom rybaka Yarte","1416":"Dom rybaka Yarte - piwnica","1417":"Chata Ficjusza","142":"Mroczna Pieczara p.2","1421":"Gildia Kupiecka","1422":"Gildia Kupiecka p.1","1423":"Gildia Kupiecka - piwnica","1427":"Dom Anecji","1428":"Dom Anecji p.1","1429":"Dom Krosnego","143":"Siedlisko Nietoperzy p.1","1430":"Dom Krosnego p.1","1433":"Dom Aurusa","1434":"Dom Aurusa p.1","1435":"Dom Klacynii","1436":"Dom Klacynii p.1","1437":"Dom Klacynii - piwnica","1438":"Kamienica Wernaidy","1439":"Kamienica Wernaidy p.1","144":"Siedlisko Nietoperzy p.2","1440":"Dom Mii","1441":"Dom Mii p.1","1442":"Arena Gladiatorów","1446":"Piracka Kryjówka","1447":"Piracka Kryjówka - piwnica","145":"Siedlisko Nietoperzy p.3 - sala 1","1453":"Dom szkutnika Verne","1454":"Dom szkutnika Verne p.1","1455":"Dom szkutnika Verne - piwnica","146":"Siedlisko Nietoperzy p.4","147":"Siedlisko Nietoperzy p.5","1471":"Opuszczona chata","1472":"Kapitanat Portu","1473":"Siedziba Kapitana Portu","1482":"Dom Flarencji","1483":"Dom Flarencji p.1","1487":"Dom Seridiusza","1488":"Dom Seridiusza p.1","1489":"Dom Seridiusza - piwnica","1490":"Dom Bernarda","1491":"Dom Bernarda p.1","1492":"Dom Telsara","1493":"Dom Telsara p.1","1494":"Dom dziadka Jeżyka","1495":"Dom Toramidamusa","1496":"Dom Toramidamusa p.1","1497":"Dom Randala Rotguta","1498":"Dom Randala Rotguta p.1","1499":"Dom Mei Shang Lii","15":"Jaskinia Łowców p.1","150":"Zapomniany Szlak","1500":"Dom Mei Shang Lii p.1","1501":"Dom Mei Shang Lii - piwnica","1502":"Łaźnia - część damska","1503":"Łaźnia - część męska","1504":"Łaźnia - piwnica","1505":"Dom Toramidamusa - piwnica","1506":"Łaźnia męska - szatnia","1507":"Łaźnia damska - szatnia","1516":"Magistrat p.1","1517":"Magistrat p.2","1518":"Magistrat - skarbiec","1520":"Wartownia","1521":"Wartownia p.1","1522":"Arena","1523":"Arena Gladiatorów p.1","1524":"Arena Gladiatorów - piwnica","1525":"Ukryta Grota Morskich Diabłów","1526":"Ukryta Grota Morskich Diabłów - skarbiec","1527":"Ukryta Grota Morskich Diabłów - siedziba","1528":"Ukryta Grota Morskich Diabłów - arsenał","1529":"Duża cela gladiatora 1","1530":"Cela gladiatora 1","1531":"Łaźnia p.1","1532":"Duża cela gladiatora 2","1533":"Duża cela gladiatora 3","1534":"Cela gladiatora 2","1535":"Cela gladiatora 3","1536":"Cela gladiatora 4","1537":"Cela gladiatora 5","1538":"Cela gladiatora 6","1539":"Zajazd pod Różą Wiatrów","154":"Krasowa Pieczara p.1","1541":"Zajazd pod Różą Wiatrów p.1","1542":"Zajazd pod Różą Wiatrów p.2","1543":"Zajazd pod Różą Wiatrów - kawiarnia","1544":"Apartament 6","1545":"Apartament 1","1546":"Apartament 2","1547":"Apartament 3","1548":"Apartament 4","1549":"Apartament 5","155":"Krasowa Pieczara p.2","1550":"Apartament 101","1551":"Apartament 102","1552":"Apartament 103","1553":"Apartament 104","1554":"Apartament 105","1555":"Apartament 7","1556":"Apartament 8","1557":"Apartament 9","1558":"Apartament 10","1559":"Apartament 106","156":"Krasowa Pieczara p.3","1560":"Apartament 107","1561":"Apartament 108","1562":"Apartament 109","1563":"Apartament 110","1564":"Dom Losso Minewita","1565":"Dom Losso Minewita p.1","1566":"Dom Senekjusza","1567":"Dom Horsfei","1568":"Pokój Grety","1569":"Dom Wirkliusza Runaberda","157":"Dom Artenii i Tafina","1570":"Dom Wirkliusza Runaberda p.1","1571":"Dom Wirkliusza Runaberda - piwnica","1572":"Posterunek","1573":"Posterunek p.1","1574":"Dom Flopka","1575":"Mury zachodnie Tuzmer","1576":"Dom Leksosa","1577":"Dom Leksosa p.1","1578":"Dom Tane","1579":"Dom Tane - piwnica","158":"Dom Artenii i Tafina p.1","1580":"Dom Hawaikiego","1581":"Dom Hawaikiego p.1","1582":"Dom Hawaikiego - piwnica","1589":"Pusty dom","159":"Dom Burmistrza","1590":"Dom Rongo","1594":"Dom Adanny","1595":"Lecznica dla zwierząt","1596":"Miejska Biblioteka","1597":"Dom Adanny p.1","1599":"Dom Jallosa","16":"Jaskinia Łowców p.0","160":"Dom Burmistrza p.1","1600":"Kamienica Bursztynek","1601":"Kamienica Bursztynek p.1","1602":"Dom Leinne","1603":"Dom Leinne - piwniczka","1604":"Latarnia","1605":"Latarnia p.1","1606":"Latarnia p.2","1608":"Namiot kapitana","1609":"Namiot","161":"Pracownia Bonifacego","1610":"Namiot","1611":"Kuchnia polowa","1612":"Magazyn","1614":"Kanały pod Portem Tuzmer","162":"Dom Erniego","1623":"Opuszczony dom - piwnica","1624":"Opuszczony dom - piwnica p.1","1625":"Tajemnicze przejście","1626":"Opuszczony dom","1627":"Dom Łasicy","1628":"Dom Danillo","1629":"Dom Lorenzo","163":"Dom Schadzek","1630":"Dom Lorenzo - składzik","1631":"Kwatera rozbójników","164":"Dom Schadzek p.1","165":"Magazyn Eder","1654":"Jaskinia Gnollich Szamanów p.1","166":"Dom Grambera","1663":"Skalne Cmentarzysko p.3 - wnęka","1664":"Pieczara Niepogody p.1","1665":"Pieczara Niepogody p.2 - sala 1","1667":"Pieczara Niepogody p.3","1668":"Pieczara Niepogody p.4","167":"Przeklęty Zamek - wejście południowe","1670":"Pieczara Niepogody p.2 - sala 2","1674":"Więzienie Nithal","168":"Przeklęty Zamek - wejście północne","1688":"Pieczara Niepogody p.5","169":"Przeklęty Zamek - wejście wschodnie","1696":"Kamienica Vilgara","1697":"Dom Konstantego i Forsycji","1698":"Dom Konstantego i Forsycji p.1","17":"Zajazd u Makiny","170":"Przeklęty Zamek - podziemia północne","1701":"Posterunek","1702":"Posterunek - piwnica","1707":"Rezydencja Vonikur","1709":"Rezydencja Vonikur - kuchnia","171":"Przeklęty Zamek - podziemia południowe","1710":"Rezydencja Vonikur - biblioteczka","1715":"Karmazynowa siedziba","1716":"Karmazynowa siedziba - piwnica","172":"Przeklęty Zamek - zbrojownia","1720":"Uniwersytet płd. - aula","173":"Przeklęty Zamek - kanały","1730":"Cmentarzysko Szerpów","1733":"Lodowa Wyrwa p.1 s.1","1734":"Lodowa Wyrwa p.1 s.2","1735":"Lodowa Wyrwa p.2","1736":"Sala Lodowych Iglic","1737":"Posłaniec Śmierci","1738":"Agia Triada","1739":"Archipelag Bremus An","174":"Przeklęty Zamek - sala zgromadzeń","1740":"Wyspa Ingotia","1741":"Wyspa Rem","1742":"Wyspa Caneum","1743":"Wyspa Magradit","1744":"Wyspa Wraków","1745":"Grota Caerbannoga - leże bestii","1746":"Grota Caerbannoga","175":"Przeklęty Zamek p.1","1754":"Pokój 11","1755":"Pokój 12","1759":"Dom Jofusa p.1","176":"Mokra Grota p.1","1760":"Kaplica","1761":"Bagnista Dolina Dusz","1764":"Jaskinia","1765":"Jaskinia - pracownia","1766":"Jaskinia - kapliczka","177":"Mokra Grota p.2","1782":"Kamienica Mirutki","1787":"Rezydencja Vonikur p.2","1788":"Mistyczny Bór","1789":"Dom Kluspa p.1","179":"Mroczna Pieczara p.1 - sala 3","1790":"Dom Maryśki","1791":"Południowa strażnica Dwóch Koron p.3","1792":"Dom Aberyta - piwnica","1793":"Namiot leśniczego","1798":"Opuszczony dom","1799":"Opuszczony dom p.1","18":"Dom Unila","180":"Andarum Ilami","1800":"Migotliwa Pieczara","1801":"Huta żelaza","1802":"Skład Kluspa","1803":"Skład surowców","1804":"Skład surowców - piwnica","1805":"Kamienica Kandelia","1806":"Kamienica Kandelia p.1","1807":"Kamienica Kandelia - piwnica","1808":"Kamienica Kandelia - strych","1809":"Dom Lenki","1810":"Dom Lenki p.1","1811":"Dom Lenki - piwnica","1812":"Dom Kalicji i Apoksa - piwnica","1813":"Dom Aurelii i Dionizego","1814":"Dom Aurelii i Dionizego p.1","1815":"Pracownia Inetora p.1","1816":"Dom Inetora","1817":"Dom Inetora p.1","1818":"Magazyn","1819":"Magazyn p.1","182":"Solna Grota p.1","1820":"Magazyn - piwnica","1822":"Gildia Kupców - piwnica","1823":"Dom Kaliposa p.1","1824":"Dom Kaliposa - strych","1825":"Dom Kaliposa - piwnica","1826":"Rozładownia","1827":"Mieszkanie sztygara","1828":"Kamienica Newalda p.1","1829":"Kamienica Slina","183":"Solna Grota p.2","1830":"Kamienica Slina p.1","1831":"Kamienica Slina - pokój","1832":"Kamienica Slina - piwnica","1833":"Dom Remiusza p.1","1836":"Warsztat miecznika","1837":"Warsztat miecznika - piwnica","1838":"Gildia Nerthusa - biblioteka","1839":"Gildia Nerthusa - sala prelekcyjna","1843":"Dom Johana","1844":"Dom Johana - piwnica","1845":"Dom Johana p.1","1846":"Lokum krasnoludów","1847":"Lokum krasnoludów p.1","1849":"Lokum krasnoludów - piwnica p.1","1850":"Lokum krasnoludów - piwnica p.2","1863":"Dom Zeiny","1865":"Sklep Garka","1878":"Kopalnia Faluntamir p.2 - sala 2","1879":"Kopalnia Faluntamir p.3 - sala 2","188":"Mroczna Pieczara p.1 - sala 2","1880":"Lochy miejskie","1881":"Lochy miejskie - podziemia","1883":"Dom Menarika","1884":"Dom płatnerza","1885":"Dom płatnerza - piwnica","1886":"Dom płatnerza - piwnica p.2","1887":"Pracownia płatnerza","1888":"Pracownia płatnerza - skład","1889":"Dom płatnerza p.1","189":"Mroczna Pieczara p.0","1894":"Dom rzeźnika","1895":"Dom rzeźnika p.1","1896":"Dom rzeźnika - piwnica","1897":"Dom Maryśki - piwnica","19":"Spustoszona jaskinia","190":"Siedziba Maga","1901":"Niecka Xiuh Atl","1902":"Gildia Teologów","1903":"Gildia Teologów - korytarz za ołtarzem","1904":"Gildia Teologów - archiwum","1905":"Gildia Teologów - pracownia archeologa","1906":"Gildia Teologów - pracownia historyka","1907":"Namiot kościarza","1908":"Warsztat kowala Kalpusa","1909":"Mieszkanie kowala Kalpusa p.1","191":"Stary magazyn","1912":"Zalana Grota","1913":"Dom rodziny Martel","1914":"Dom rodziny Martel p.1","1915":"Dom rodziny Martel - piwnica","1916":"Dom Mafki i Hieronima","1917":"Dom Mafki i Hieronima p.1","1918":"Dom Mafki i Hieronima - piwnica","192":"Stary magazyn - piwnica","1920":"Pracownia Toksyniusza","1921":"Dom Benia i Zgryzeldy","1922":"Dom Zbigniewa","1923":"Dom Zbigniewa p.1","1924":"Dolina Chmur","1925":"Stajnie","1926":"Altepetl Mahoptekan","1929":"Dom Rozalii","193":"Stary magazyn - poddasze","1930":"Dom Rozalii p.1","1931":"Dom Rozalii - piwnica","1933":"Dom Alabraskana p.1","1934":"Dom Alabraskana - piwnica","1935":"Dom Enoliana p.1","1936":"Dom Enoliana - spiżarnia","1939":"Dom Barnesa","194":"Grota Złoczyńców p.1","1940":"Dom Barnesa p.1","1941":"Dom Barnesa - kuchnia","1942":"Dom Barnesa - pracownia","1943":"Dom Barnesa - skład","1944":"Dom Gindera p.1","1945":"Opuszczony dom","1946":"Namiot wiedźmy","1947":"Jaskinia wiedźmy","1948":"Gildia Teologów - biuro inkwizytora","195":"Grota Złoczyńców p.2","1950":"Gildia Teologów - przejście do jaskiń","1955":"Namiot Amry","196":"Grota Złoczyńców p.3","1960":"Gildia Wynalazców","1961":"Gildia Wynalazców - aula uniwersytecka","1962":"Gildia Wynalazców - laboratorium Tii Rumore","1964":"Gildia Wynalazców - pracownia Netheralena","1966":"Gildia Wynalazców - opuszczona czytelnia","197":"Grota Złoczyńców p.4","1970":"Rezydencja Tussal","1971":"Rezydencja Tussal p.1 - sypialnia","1972":"Rezydencja Tussal p.1 - gabinet","1975":"Wrzosowiska","1977":"Wnętrze drzewa","1980":"Koszary","1981":"Koszary p.1","1982":"Koszary - gabinet kapitana","1983":"Koszary - piwnica","1985":"Żołnierski Korytarz","1987":"Targ Poszukiwaczy Przygód","199":"Pieczara Szaleńców - sala 1","1990":"Dom Żaka","1991":"Dom Żaka p.1","2":"Torneg","20":"Opuszczona Grota","200":"Pieczara Szaleńców - sala 2","2002":"Kurnik","2006":"Karczma pod Chimerą","2007":"Karczma pod Chimerą p.1","201":"Pieczara Szaleńców - sala 3","2010":"Dom Erniego p.1","2011":"Dom Artenii i Tafina - piwnica","2012":"Zbójecka spiżarnia","2013":"Zbójecka spiżarnia - przyziemie","2014":"Zbójecka spiżarnia p.1","2015":"Zbójecka spiżarnia - zbrojownia","2016":"Dom Etrefana - pracownia","2017":"Dom Etrefana p.1","2018":"Dom Etrefana p.2","202":"Pieczara Szaleńców - sala 4","2020":"Grań Gawronich Piór","2029":"Łany Zboża","2031":"Piekarnia","2032":"Piekarnia p.1","2033":"Młyn","2034":"Młyn p.1","2035":"Młyn p.2","2036":"Dom Mazteni i Ułtana","2037":"Dom Mazteni i Ułtana p.1","2038":"Dom Mazteni i Ułtana p.2","2039":"Oberża pod Złotym Kłosem","2040":"Oberża pod Złotym Kłosem p.1","2041":"Magazyn","2042":"Magazyn p.1","2043":"Oberża pod Złotym Kłosem p.2","2044":"Oberża pod Złotym Kłosem - piwnica","2046":"Dom Buddenbrooków","2053":"Dom Paniki i Llacha","2056":"Szczerba Samobójców","2058":"Dom Vincenta","2059":"Dom Vincenta p.1","206":"Karczma pod Złotą Wywerną","2060":"Dom Vincenta - piwnica","2061":"Dom Gepperta - warsztat","2062":"Dom Gepperta - pokój","2063":"Przysiółek Valmirów","207":"Karczma pod Złotą Wywerną p.1","2070":"Mury - skrzydło zachodnie","2071":"Mury - skrzydło północne","2072":"Mury - skrzydło wschodnie","2073":"Mury - zbrojownia","2075":"Mury - kwatera główna","2076":"Baszta Koci Łeb","2077":"Baszta Nietoperzy","208":"Karczma pod Złotą Wywerną p.2","21":"Opuszczona Grota - sala 2","2120":"Karmazynowa sala","2121":"Dom Drowina","2122":"Dom Drowina p.1","2123":"Dom Drowina - piwnica","2124":"Warsztat Drowina","2125":"Warsztat Drowina - piwnica","2131":"Austeria Karibiego","2132":"Austeria Karibiego p.1","2133":"Austeria Karibiego p.2","2134":"Izba 101","2135":"Szlachecka izba 1","2136":"Izba 102","2137":"Izba 103","2138":"Izba 201","2139":"Izba 202","214":"Spokojne Przejście","2140":"Izba 203","2141":"Szlachecka izba 2","215":"Siedziba Maga","2156":"Drukarnia Zenka","2157":"Drukarnia Zenka p.1","2158":"Drukarnia Zenka - piwnica","2163":"Baszta Puchacza","2164":"Baszta Puchacza p.1","2165":"Baszta Puchacza p.2","2166":"Baszta Puszczyka","2167":"Baszta Puszczyka p.1","2168":"Baszta Sowy","2169":"Baszta Sowy p.1","2170":"Baszta Sowy p.2","2171":"Sztab Dowódczy","2172":"Sowie Lochy","2177":"Austeria Karibiego - Rozkosz nad Rozkoszami","218":"Siedziba Maga - pracownia","2180":"Dom Hernaka","2181":"Dom Hernaka - stodoła","2183":"Skrawek Raju","2186":"Katakumby Rozkoszy","219":"Dom Etrefana","2197":"Dom Barabasza","2198":"Dom Barabasza p.1","2199":"Dom Cedrika","22":"Opuszczona Grota p.2","220":"Dom Mikliniosa","2203":"Dom Wei p.1","2204":"Dom Idalii - piwnica","2205":"Dom Sary p.1","2206":"Dom Syntii i Leona","2207":"Dom Syntii i Leona p.1","221":"Dom Mrocznego Zgrzyta","2210":"Dom Cedrika p.1","2211":"Dom Szagarata p.1","2213":"Dom Salome","2214":"Dom Salome p.1","2215":"Dom Salome - piwnica","2217":"Dom Toksyniusza","2218":"Dom Toksyniusza p.1","2219":"Lecznica dla zwierząt - piwnica","222":"Zasłonięte Jezioro","2220":"Lecznica dla zwierząt p.1","223":"Słoneczna Wyżyna","224":"Kamienne Lokum","225":"Kamienne Lokum p.1","226":"Cienisty Bór","229":"Las Dziwów","2290":"Sowia Dziupla","23":"Granitowa Jaskinia","2308":"Stary Kupiecki Trakt","231":"Pieczara Pajęczyn p.1","2317":"Namiot Bandytów","232":"Pieczara Pajęczyn p.2","2324":"Stukot Widmowych Kół","233":"Pieczara Pajęczyn p.3","2337":"Klasztor Różanitów - świątynia","234":"Pieczara Pajęczyn p.4","2341":"Dom Mikliniosa p.1","2342":"Dom Mikliniosa - przyziemie","2343":"Wrak statku","2344":"Kuźnia na Rozstajach","2345":"Kuźnia na Rozstajach p.1","2346":"Kuźnia na Rozstajach - piwnica","2347":"Kamienica Nitrusa - piwnica","2348":"Pracownia Bonifacego - przyziemie","2349":"Pracownia Bonifacego p.1","235":"Ratusz Karka-han","2350":"Ciemnica Szubrawców p.1 - sala 1","2351":"Ciemnica Szubrawców p.1 - sala 2","2352":"Ciemnica Szubrawców p.1 - sala 3","2353":"Sala Lodowej Magii","2354":"Sala Mroźnych Szeptów","2355":"Przejście Władców Mrozu","2356":"Sala Mroźnych Strzał","2357":"Korytarz Zagubionych Marzeń","2360":"Dom Lussa - piwnica","2391":"Klasztor Różanitów - wirydarz","2392":"Dom Trajnaloka p.1","24":"Granitowa Jaskinia p.2","2428":"Ognista Rozpadlina","2430":"Szopa","244":"Fort Eder","246":"Złowrogie Bagna","247":"Fortyfikacja","248":"Fortyfikacja p.1","2482":"Dom Angussa - pracownia","2483":"Dom Felikssiana p.1","2484":"Tawerna pod Szemrzącą Beczułką","2485":"Klasztor Różanitów - klatka schodowa płn.-zach.p.1","2486":"Klasztor Różanitów - klatka schodowa płn.-zach.p.2","2487":"Klasztor Różanitów - klatka schodowa płn.-zach.p.3","2488":"Klasztor Różanitów - wieża płn.-zach. p.1","2489":"Klasztor Różanitów - wieża płn.-zach. p.2","249":"Fortyfikacja p.2","2490":"Klasztor Różanitów - cela opata","2491":"Kopiec Mrówek p.2","2492":"Klasztor Różanitów - klatka schodowa płn.-wsch.p.1","2493":"Klasztor Różanitów - wieża płn.-wsch. p.1","2494":"Klasztor Różanitów - strych p.1","2495":"Klasztor Różanitów - strych p.2","2496":"Klasztor Różanitów - kapitularz","2497":"Klasztor Różanitów - fraternia","2498":"Klasztor Różanitów - refektarz","2499":"Klasztor Różanitów - dormitoria","250":"Fortyfikacja p.3","2500":"Klasztor Różanitów - korytarz wejściowy","2501":"Klasztor Różanitów - pomieszczenia gospodarcze","2502":"Klasztor Różanitów - klasztorny browar","2503":"Klasztor Różanitów - klasztorna piekarnia","2504":"Klasztor Różanitów - lawaterz","2505":"Klasztor Różanitów - klatka schodowa płd.-wsch.p.1","2506":"Klasztor Różanitów - warsztat","2507":"Klasztor Różanitów - klatka schodowa płd.-zach.p.1","2508":"Klasztor Różanitów - magazyn ksiąg","2509":"Klasztor Różanitów - dzwonnica","251":"Fortyfikacja p.4","2510":"Klasztor Różanitów - klatka schodowa płd.-zach.p.2","2511":"Klasztor Różanitów - piwniczka","2517":"Kopalnia Dogoran p.1","2518":"Kopalnia Dogoran p.2","2519":"Kopalnia Dogoran p.3","252":"Fortyfikacja p.5","2520":"Leśny Bród","2521":"Siedlisko Nietoperzy p.3 - sala 2","2522":"Mrowisko","2523":"Kopiec Mrówek","2524":"Pagórki Łupieżców","2528":"Mrowisko p.1","2529":"Kopiec Mrówek p.1","253":"Smocze Góry","2530":"Kamienna Kryjówka","2531":"Skład Grabieżców","2532":"Schowek na Łupy","2534":"Ratusz Ithan - więzienie","2536":"Warczące Osuwiska","2537":"Wilcza Nora p.1","2538":"Wilcza Nora p.2","2546":"Nekropolia Karka-han","2547":"Klasztor Różanitów - skarbczyk","256":"Dom Lussa","2562":"Jaskinia Łez","257":"Mythar","258":"Przybytek Zakonu Białej Róży","26":"Dom Roana","261":"Ukryty Kanion","262":"Dziki Zagajnik","2620":"Dom Befry","2622":"Dom Befry p.1","263":"Skały Pamięci Nikantosa","264":"Przełęcz Krwistego Posłańca","2646":"Namiot Vari Krugera","265":"Przepaść Aguti","2659":"Dom Eldrika p.1","2661":"Dom Unila p.1","2662":"Dom Huslina p.1","2663":"Jaskinia Łowców p.2","2665":"Pod Rozbrykanym Niziołkiem","2666":"Pod Rozbrykanym Niziołkiem - piwnica","2667":"Pod Rozbrykanym Niziołkiem - piętro","2668":"Mansarda Vincenta","268":"Błędny Szlak","269":"Kopalnia Faluntamir p.1","27":"Dom Roana - piętro","270":"Kopalnia Faluntamir p.2 - sala 1","2709":"Izba wytrzeźwień","271":"Kopalnia Faluntamir p.3 - sala 1","2710":"Kordegarda","2711":"Strażnica północno-wschodnia","2712":"Strażnica południowo-zachodnia","2713":"Strażnica południowo-wschodnia","2714":"Zaplecze","2715":"Składy","2716":"Przejście południowo-wschodnie","2717":"Przejście północno-wschodnie","2718":"Wschodnie skrzydło murów","2719":"Archiwa","272":"Kopalnia Faluntamir p.4","2720":"Strażnica północno-zachodnia","2721":"Zachodnie skrzydło murów","2722":"Przejście południowo-zachodnie","2729":"Lazurytowa Grota p.4","273":"Dom Jofusa","2730":"Opuszczony Bastion","2731":"Podziemne Przejście p.1","2732":"Podziemne Przejście p.2","2733":"Zrujnowana Wieża","2734":"Wesołe Miasteczko","274":"Dom Jofusa - piwnica","275":"Zakurzone przejście","2758":"Sala Tronowa","276":"Radosna Polana","2774":"Ostoja Marzeń","2775":"Dom Torkina","2776":"Dom Torkina - strych","2778":"Wąwóz Trolla","278":"Szyb Mahnior p.1","2783":"Mrowisko p.2","279":"Szyb Mahnior p.2","2790":"Jaskinia Medytacji Tududu","28":"Piekielna Grota p.1","280":"Szyb Mahnior p.3","2817":"Grota Wiedźmiej Złośliwości","2818":"Piwnica pod Domem Schadzek","282":"Szyb Mahnior p.4","2825":"Las Milczących Cieni","2828":"Lisia jama","283":"Twierdza Magów","284":"Śnieżna Grota p.1","285":"Śnieżna Grota p.2","286":"Śnieżna Grota p.3","2864":"Sucha Dolina","2865":"Płaskowyż Arpan","2866":"Oaza Siedmiu Wichrów","2867":"Złote Piaski","2868":"Ruiny Pustynnych Burz","2869":"Ciche Rumowiska","287":"Lodowa Sala","2870":"Dolina Suchych Łez","2871":"Dolina Pustynnych Kręgów","2872":"Piachy Zniewolonych","2873":"Ruchome Piaski","2877":"Krypta Rodu Heregata","2878":"Krypta Rodu Heregata p.1","2879":"Krypta Rodu Heregata p.2 - lewe skrzydło","288":"Podziemna pasieka","2880":"Krypta Rodu Heregata p.2 - prawe skrzydło","2881":"Dom Torkina (wersja przed questami)","2882":"Dom Torkina - strych (wersja przed questami)","2883":"Ostoja Marzeń (wersja przed questami)","2884":"Grobowiec Rodziny Tywelta","2885":"Grobowiec Rodziny Tywelta p.1","2886":"Grobowiec Rodziny Tywelta p.2","2887":"Pustkowia Pogrzebanych","2888":"Rudera","2889":"Piwnica rudery","2890":"Korytarz pod Eder","29":"Piekielna Grota p.2","290":"Opactwo","291":"Opactwo p.1","2919":"Dom Anulisa","292":"Opactwo - piwnica","293":"Namiot pustelnika","294":"Zajazd pod Zielonym Jednorożcem","295":"Zajazd pod Zielonym Jednorożcem p.1","2950":"Pizzeria","2951":"Pizzeria - piwnica","2952":"Podziemia - p.1","2953":"Podziemia - p.2","2954":"Odnoga kanału","2955":"Podziemia - p.3","2956":"Podziemia - p.1","2957":"Podziemia - p.1","2958":"Podziemia - p.1","2959":"Podziemia - p.2","296":"Zajazd pod Zielonym Jednorożcem - piwnica","2960":"Podziemia - p.2","2961":"Podziemia - p.2","2962":"Odnoga kanału","2963":"Odnoga kanału","2964":"Odnoga kanału","2965":"Podziemia - p.3","2966":"Podziemia - p.3","2967":"Podziemia - p.3","2968":"Podziemia - p.1","2969":"Podziemia - p.1","297":"Dom Eldrika","2970":"Podziemia - p.1","2971":"Podziemia - p.1","2976":"Podziemia - p.2","2977":"Podziemia - p.2","2978":"Podziemia - p.2","2979":"Podziemia - p.2","298":"Smocza Jaskinia","2980":"Podziemia - p.3","2981":"Podziemia - p.3","2982":"Podziemia - p.3","2983":"Podziemia - p.3","2984":"Odnoga kanału","2985":"Odnoga kanału","2986":"Odnoga kanału","2987":"Odnoga kanału","299":"Przełaz olbrzymów","3":"Orla Grań","30":"Piekielna Grota p.3 - sala 1","302":"Dom Kastora","3025":"Jaskinia Gnomów","3029":"Pustynne Katakumby - sala 1","3030":"Pustynne Katakumby - sala 2","3031":"Pustynne Katakumby - sala 3","3032":"Pustynne Katakumby - sala 4","3033":"Pustynne Katakumby - sala 5","3034":"Pustynne Katakumby - Komnata Odnalezionych Skrytobójców","3035":"Pustynne Katakumby - Komnata Gwałtownej Śmierci","3036":"Pustynne Katakumby - Komnata Opętanych Dusz","3037":"Pustynne Katakumby - Komnata Krwawych Wypraw","3038":"Pustynne Katakumby - Komnata Poległych Legionistów","3039":"Pustynne Katakumby - Grobowiec Seta","304":"Dom Aberyta","3040":"Pustynne Katakumby - Korytarz Porzuconych Nadziei","3041":"Pustynne Katakumby - Korytarz Porzuconych Marzeń","3042":"Pustynne Katakumby - Wschodni Tunel Jaźni","3043":"Pustynne Katakumby - Zachodni Tunel Jaźni","3045":"Ukryty korytarz","305":"Dom Aberyta p.1","306":"Dom Lussa p.1","307":"Dom Essy i Frassona","3074":"Pokój 13","3075":"Pokój 14","3076":"Pokój 15","3079":"Jaskinia demona","308":"Dom Lassindy i Limerusa","3081":"Dom Niela","3085":"Zaklęte Jezioro Nimf","3086":"Ukryte przejście","3087":"Ukryty labirynt","309":"Dom Lassindy i Limerusa p.1","3090":"Zasypana piwnica","3091":"Sekretna sala","31":"Piekielna Grota p.3 - sala 2","310":"Dom Saprasa","3100":"Złote Szczyty","3104":"Wyspa Wiśni","311":"Dom Presztreka","312":"Dom Presztreka p.1","313":"Sala Zgromadzeń","3130":"Gildia Nerthusa - przedsionek","3131":"Gildia Nerthusa - sala obrad","3132":"Karczma pod Liściem Dębu","3133":"Karczma pod Liściem Dębu - sala do kostkowania","3134":"Gildia Nerthusa p.1","314":"Kuźnia Frassona","3149":"Jaskinia Pogardy","315":"Dom Trajnaloka","3150":"Karczma pod Liściem Dębu - piwnica","3152":"Tajemniczy tunel","316":"Dom Walasara","317":"Dom Walasara p.1","318":"Dom Węży","319":"Pracownia Polassa","32":"Piekielna Grota p.4","320":"Siedziba Ergassaj","321":"Siedziba Ergassaj p.1","322":"Dom Krassa","3220":"Ukryta Grota Morskich Diabłów - korytarz","323":"Dom Umplecji i Kiliona","324":"Alabastrowy Hotel","3246":"Zapomniana kopalnia p.1","3247":"Zapomniana kopalnia p.2","3248":"Zapomniana kopalnia p.3","325":"Dom Jemenossa","326":"Dom Felkissiana","3263":"Namiot ubogich ludzi","327":"Dom Angussa","3271":"Pokój Aury","328":"Dom Liszli i Semkosa","329":"Piętro Afrassy i Brasza","33":"Eder","330":"Zawiły Bór","3300":"Czeluść Ognistej Pożogi","331":"Iglaste Ścieżki","3312":"Sekretne Przejście Kapłanów","3313":"Sala Zrujnowanej Świątyni","3315":"Pustynia Shaiharrud - zachód","3316":"Namiot Piechoty Piłowej","3317":"Namiot Naznaczonych","3318":"Jurta Czcicieli","3319":"Namiot Gwardii Smokoszczękich","332":"Selva Oscura","3320":"Sępiarnia","3321":"Jurta Chaegda","3322":"Jurta Nomadzka","3323":"Namiot Pustynnych Smoków","3324":"Namiot Błogosławionych","3325":"Pustynia Shaiharrud - wschód","3326":"Smocze Skalisko","3327":"Urwisko Vapora","3328":"Skały Umarłych","3329":"Jaskinia Sępa s.2","333":"Wioska Gnolli","3330":"Jaskinia Sępa s.1","3331":"Jaskinia Piaskowej Burzy s.1","3332":"Jaskinia Piaskowej Burzy s.2","3333":"Jaskinia Szczęk","3334":"Jaskinia Smoczej Paszczy p.1","3335":"Jaskinia Smoczej Paszczy p.2","3336":"Jaskinia Odwagi","3337":"Jaskinia Próby","3338":"Grota Poświęcenia","3339":"Świątynia Hebrehotha - przedsionek","3340":"Świątynia Hebrehotha - sala ofiary","3341":"Świątynia Hebrehotha - sala czciciela","3342":"Magazyn Krasnoludów - piwnica","3343":"Wylęgarnia","3357":"Składzik beczek","3358":"Grobowiec Zapomnianych","336":"Solny Szyb p.1","3361":"Pradawne Wzgórze Przodków","337":"Solny Szyb p.2","3370":"Świątynia Mzintlavy","3375":"Dom Tane - strych","338":"Solny Szyb p.3","339":"Gadzia Kotlina","34":"Dom Huslina","340":"Jaskinia Magów","3402":"Polana Ścierwojadów","3409":"Ukryta Grota Morskich Diabłów - magazyn","341":"Jaskinia Gnollich Szamanów p.2","342":"Dom Torina","343":"Dom Torina p.1","3436":"Jaskinia Gnollich Szamanów p.3","3437":"Jaskinia Gnollich Szamanów - komnata Kozuga","3438":"Grota Pragnolli p.1","3439":"Grota Pragnolli p.1 - sala 2","344":"Kwieciste Przejście","3440":"Grota Pragnolli p.2","3441":"Grota Pragnolli p.2 - sala 2","3442":"Grota Pragnolli p.3","345":"Dom Kluspa","3457":"Grota Samotnych Dusz p.3 - sala wyjściowa","3459":"Mirvenis-Adur","346":"Dom Kluspa - piwnica","3460":"Trakt Moradrana","3464":"Grota Samotnych Dusz p.4","3465":"Grota Samotnych Dusz p.5","3466":"Grota Samotnych Dusz p.6","3467":"Szlak Thorpa p.1","3468":"Szlak Thorpa p.2","3469":"Szlak Thorpa p.3","347":"Lazurowe Wzgórze","3470":"Szlak Thorpa p.4","3471":"Szlak Thorpa p.5","3472":"Szlak Thorpa p.6","3473":"Opuszczony Szyb","3476":"Chwilowe Schronienie Browarników","3477":"Tymczasowa Pracownia Kowali","3478":"Kuźnia Giriela - manufaktura","3479":"Kuźnia Giriela - warsztat","3480":"Kuźnia Giriela - pracownia","349":"Jezioro Ważek","3499":"Browar Bimberara - warzelnia","35":"Karka-han","350":"Wyjący Wąwóz","3500":"Browar Bimberara - garkuchnia","3501":"Browar Bimberara - magazyn","3502":"Thorpela zachodnia","3503":"Thorpela wschodnia","3504":"Dom Merakliego","3505":"Dom Ypsliego","3506":"Dom Reby","3507":"Dom Ulryka","3508":"Dom Ulryka - sala zgromadzeń","3509":"Dom Jakiego","351":"Babi Wzgórek","3510":"Dom Tozruka","3511":"Kwatery u Morcera","3512":"Kwatera Thorpa 1","3513":"Kwatera 1","3516":"Gammel Khazad Gravkammer","352":"Góralskie Przejście","353":"Dom Tunii","3530":"Firnowa Grota p.2 s.1","354":"Zakon Białej Lilii - kaplica","3541":"Kwatera Thorpa 2","3542":"Kwatera Thorpa 3","3543":"Kwatera Thorpa 4","3544":"Kwatera 2","3545":"Kwatera 3","3546":"Kwatera 4","3547":"Kwatera 5","3548":"Kwatera 6","3549":"Kwatera 7","355":"Orcza Wyżyna","3550":"Kwatera 8","3551":"Kwatera 9","3552":"Kwatera 10","3553":"Kwatera 11","3554":"Kwatera 12","3555":"Kwatera 13","3556":"Kwatera 14","3557":"Kwatera 15","3558":"Kwatera 16","3559":"Kwatera 17","356":"Osada Czerwonych Orków","3560":"Kwatera 18","3561":"Kwatera 19","3562":"Kwatera 20","3563":"Kwatera 21","3564":"Kwatera 22","3565":"Kwatera 23","3566":"Kwatera 24","3567":"Kwatera 25","3568":"Kwatera 26","3569":"Kwatera 27","357":"Kurhany Zwyciężonych","3570":"Kwatera 28","3571":"Kwatera 29","3572":"Kwatera 30","3573":"Kwatera 31","3574":"Kwatera 32","3575":"Kwatera 33","3576":"Kwatera 34","3577":"Kwatera 35","3578":"Kwatera 36","3579":"Kwatera 37","358":"Ruiny Wieży Magów - przedsionek","3580":"Kwatera 38","3581":"Kwatera 39","3582":"Kwatera 40","3583":"Kwatera 41","3584":"Kwatera 42","3585":"Kwatera 43","3586":"Kwatera 44","3587":"Kwatera 45","3588":"Kwatera 46","3589":"Kwatera 47","3590":"Kwatera 48","3591":"Kwatera 49","3592":"Kwatera 50","3594":"Urwisko Zdrewniałych","3595":"Wąwóz Zakorzenionych Dusz","3596":"Regiel Zabłąkanych","3597":"Źródło Zakorzenionego Ludu","3598":"Piaskowa Gęstwina","36":"Przedmieścia Karka-han","3607":"Rezydencja Vonikur - prawe skrzydło","3608":"Rezydencja Vonikur - piwniczka","3609":"Rezydencja Vonikur - lewe skrzydło","361":"Gościniec Bardów","3610":"Jaskinia Korzennego Czaru p.1 - sala 1","3611":"Jaskinia Korzennego Czaru p.1 - sala 2","3612":"Jaskinia Korzennego Czaru p.1 - sala 3","3613":"Jaskinia Korzennego Czaru p.1 - sala 4","3614":"Jaskinia Korzennego Czaru p.2 - sala 1","3615":"Jaskinia Korzennego Czaru p.2 - sala 2","3616":"Jaskinia Korzennego Czaru p.3","3620":"Krzaczasta Grota p.1 - sala 1","3621":"Krzaczasta Grota p.1 - sala 2","3622":"Krzaczasta Grota p.1 - sala 3","3623":"Krzaczasta Grota p.2 - sala 1","3624":"Krzaczasta Grota p.2 - sala 2","3625":"Krzaczasta Grota p.2 - sala 3","3626":"Krzaczasta Grota - sala boczna","3627":"Krzaczasta Grota - korytarz","3628":"Krzaczasta Grota - sala główna","3634":"Dom Roszana p.1","368":"Zatopiony Szczyt","3687":"Izba Pamięci","369":"Baraki pokój 1","37":"Brama Północy","370":"Baraki pokój 2","371":"Baraki pokój 3","372":"Baraki pokój 4","373":"Baraki pokój 5","3733":"Wzgórza Obłędu","3734":"Dolina Gniewu","3735":"Terytorium Furii","3736":"Zapadlisko Zniewolonych","3737":"Otchłań Pajęczych Sieci","3738":"Dolina Pajęczych Korytarzy","374":"Baraki pokój 6","3740":"Zarośnięta grota","3741":"Przeklęty Zamek p.2","3742":"Przeklęty Zamek - komnata","375":"Baraki pokój 7","3758":"Mglista Polana Vesy","3759":"Wzgórze Płaczek","376":"Baraki pokój 8","3760":"Płacząca Grota p.1 - sala 1","3761":"Płacząca Grota p.1 - sala 2","3762":"Płacząca Grota p.2","3763":"Płacząca Grota p.3","3764":"Płacząca Grota - sala Lamentu","3765":"Dolina Centaurów","3766":"Ostępy Szalbierskich Lasów","377":"Baraki pokój 9","3776":"Kamienica Flawiana","3777":"Kamienica Flawiana p.1","378":"Baraki pokój 10","379":"Baraki pokój 11","38":"Uroczysko","380":"Baraki pokój 12","381":"Ratusz Karka-han - prawe skrzydło","382":"Biuro lux p.101","383":"Biuro lux p.102","3839":"Magazyn Krasnoludów","384":"Biuro lux p.103","385":"Biuro p.104","386":"Biuro p.105","3869":"Lazurytowa Grota p.3 - sala 1","387":"Biuro p.106","388":"Biuro p.107","3883":"Pieczara Szaleńców - przedsionek","3884":"Pieczara Szaleńców - sala Regulusa Mętnookiego","389":"Biuro p.108","3890":"Zapomniany Święty Gaj p.1 - sala 1","39":"Siedziba Kultystów - piwnica","390":"Biuro p.109","391":"Biuro p.110","392":"Biuro p.111","393":"Biuro p.112","394":"Izba 101","395":"Izba 103","396":"Izba 105","397":"Izba 107","398":"Izba 109","3986":"Dom Antoniego - parter","3987":"Dom Antoniego - piętro","399":"Izba 111","4":"Przełęcz Łotrzyków","40":"Karczma pod Posępnym Czerepem","400":"Izba 113","401":"Izba 102","402":"Izba 104","4023":"Jaskinia na Mokradłach","403":"Izba 106","4031":"Prosektorium","404":"Izba 108","4046":"Zmarzlina Amaimona Soplorękiego - przedsionek","4047":"Zmarzlina Amaimona Soplorękiego - sala","4048":"Potępione Zamczysko","4049":"Zachodnie Zbocze","405":"Izba 110","4050":"Plugawe Pustkowie","4051":"Jęczywąwóz","4052":"Pogranicze Wisielców","4053":"Potępione Zamczysko - korytarz wejściowy","4054":"Potępione Zamczysko - lochy zachodnie p.1","4055":"Potępione Zamczysko - lochy wschodnie p.1","4056":"Potępione Zamczysko - sala ofiarna","4057":"Potępione Zamczysko - pracownia","4058":"Potępione Zamczysko - korytarz zachodni","4059":"Potępione Zamczysko - korytarz wschodni","406":"Izba 112","4060":"Potępione Zamczysko - zachodnia komnata","4061":"Potępione Zamczysko - wschodnia komnata","4062":"Wieża Szlochów p.1","4063":"Wieża Szlochów p.2","4064":"Wieża Szlochów p.3","4066":"Czeluść Chimerycznej Natury - przedsionek","4067":"Czeluść Chimerycznej Natury - sala","407":"Izba 114","408":"Izba 115","409":"Izba 116","41":"Karczma pod Posępnym Czerepem p.1","410":"Izba 117","411":"Izba 118","412":"Izba 119","413":"Izba 120","414":"Pokój 201","415":"Pokój 202","4151":"Wertepy Rzezimieszków","4154":"Racicowy Matecznik","4155":"Ukwiecona Skarpa","4156":"Pieczara Kwiku - sala 1","4157":"Pieczara Kwiku - sala 2","416":"Pokój 203","4161":"Przepaść Zadumy - przedsionek","4162":"Przepaść Zadumy - sala","4165":"Kamienica Galeny i Sarda","4168":"Podziemne Rozpadliny","417":"Pokój 204","418":"Pokój 205","4185":"Skarpa Trzech Słów","419":"Pokój 206","4196":"Grobowiec Przeklętego Krakania - przedsionek","4197":"Grobowiec Przeklętego Krakania - sala","42":"Karczma pod Posępnym Czerepem p.2","420":"Pokój 207","4200":"Dom Azalii","4206":"Grota Przebiegłego Tkacza - przedsionek","4207":"Grota Przebiegłego Tkacza - sala","421":"Pokój 208","422":"Pokój 209","423":"Pokój 210","424":"Pokój 211","425":"Pokój 212","426":"Pokój 213","4262":"Mokra Grota p.2 - korytarz","4263":"Kamienica Zagadek","4266":"Grota Martwodrzewów - przedsionek","4267":"Grota Martwodrzewów - sala","4268":"Katakumby Antycznego Gniewu - przedsionek","4269":"Katakumby Antycznego Gniewu - sala","427":"Pokój 214","4270":"Skalisty Styk","4271":"Zacisze Zimnych Wiatrów","4272":"Jezioro Mokosz","429":"Apartament 101","4299":"Kajuta","43":"Siedziba Kultystów","430":"Apartament 102","431":"Pokój 103","432":"Pokój 104","433":"Pokój 105","434":"Pokój 106","435":"Pokój 107","436":"Pokój 108","4361":"Wrak statku","4362":"Wrak statku","437":"Pokój 109","4378":"Kajuta","438":"Pokój 110","439":"Pokój 111","4391":"Latający Holender","44":"Kopalnia Fretar p.2","440":"Pokój 112","4403":"Pszczelarski magazyn","441":"Pokój 113","4414":"Kamienica de Waldenów","442":"Pokój 114","4425":"Opuszczona kamienica","443":"Pokój 115","444":"Pokój 116","445":"Pokój 117","446":"Pokój 201","447":"Pokój 202","4474":"Tawerna pod Kocim Wąsem","448":"Pokój 203","449":"Pokój 204","45":"Kopalnia Fretar p.3","450":"Pokój 205","451":"Pokój 206","452":"Pokój 207","4528":"Chata szabrowników","453":"Pokój 208","454":"Pokój 209","4546":"Legowisko Wilczej Hordy","4547":"Wilcza Skarpa","4548":"Śnieżna Granica","4549":"Śnieżycowy Las","455":"Pokój 210","4550":"Mokra Grota p.1 - boczny korytarz","456":"Pokój 211","457":"Pokój 212","458":"Pokój 213","4582":"Mokra Grota p.1 - przełaz","459":"Pokój 214","46":"Kopalnia Fretar - sala 1","460":"Pokój 215","461":"Pokój 216","462":"Pokój 217","4629":"Redrock","463":"Pokój 218","4630":"Czerwony Szlak","4631":"Osada plemienia Banok","4632":"Posterunek szeryfa","464":"Pokój 219","4646":"Bank","4647":"Saloon","465":"Pokój 220","4652":"Zakład balwierski","466":"Pokój 221","4669":"Redrock","467":"Pokój 222","4671":"Kopalnia w Redrock","468":"Pokój 223","469":"Pokój 224","47":"Kopalnia Fretar - sala 2","470":"Pokój 225","471":"Pokój 226","4711":"Rodzinna chata","472":"Pokój 227","4727":"Sklep u Joego","473":"Pokój 228","4730":"Redrock","4733":"Dom Mrocznego Zgrzyta - pracownia","4734":"Jaskinia przemytników","474":"Pokój 229","475":"Pokój 230","476":"Pokój 231","4764":"Włości rodu Kruzo","4765":"Posiadłość Kruzo - przedsionek","4766":"Posiadłość Kruzo - sala główna","4767":"Posiadłość Kruzo - budynek gospodarczy","4768":"Posiadłość Kruzo - strażnica zachodnia","4769":"Posiadłość Kruzo - magazyn","477":"Pokój 232","4770":"Posiadłość Kruzo - stajnia","478":"Pokój 233","479":"Pokój 234","4798":"Jama Kocich Ślepi","48":"Kopalnia Fretar - sala 3","480":"Pokój 235","481":"Pokój 236","482":"Pokój 237","483":"Pokój 238","484":"Pokój 239","485":"Pokój ergassaj 101","486":"Pokój ergassaj 102","487":"Pokój ergassaj 103","488":"Pokój ergassaj 104","489":"Pokój ergassaj 105","49":"Kopalnia Inlefi p.1","490":"Pokój ergassaj 106","491":"Pokój ergassaj 107","492":"Pokój ergassaj 108","493":"Pokój ergassaj 109","494":"Pokój ergassaj 110","495":"Pokój ergassaj 111","496":"Pokój ergassaj 112","497":"Pokój ergassaj 113","498":"Pokój ergassaj 114","499":"Pokój ergassaj 115","4998":"Namiot Kambiona","4999":"Skarbiec Magicznych Mykonidów","5":"Baraki","50":"Kopalnia Inlefi p.2","500":"Liściaste Rozstaje","501":"Dom Nufrexa","502":"Piwnica Nufrexa","503":"Alabastrowy Hotel - piwnica p.1","504":"Alabastrowy Hotel - piwnica p.2","505":"Apartament 101","506":"Apartament 102","507":"Apartament 103","508":"Apartament 104","509":"Apartament 105","510":"Apartament 106","511":"Apartament 107","512":"Apartament 108","513":"Apartament 109","514":"Apartament 110","5145":"Zacisze Czarownic","5147":"Gęstwina Pszczelego Królestwa","515":"Apartament 111","516":"Apartament 112","517":"Apartament 201","518":"Apartament 202","519":"Apartament 203","52":"Kopalnia Latimeria p.1","520":"Apartament 204","521":"Apartament 205","522":"Apartament 206","523":"Apartament 207","524":"Apartament 208","525":"Apartament 209","526":"Apartament 210","527":"Apartament 211","528":"Apartament 212","529":"Apartament 213","5293":"Skalne Turnie","53":"Kopalnia Latimeria p.2","530":"Złudny Trakt","531":"Apartament 1","532":"Apartament 2","533":"Izba 1","534":"Izba 2","535":"Izba 3","536":"Izba 4","537":"Izba 5","538":"Izba 6","539":"Izba 7","5394":"Kopalnia Kapiącego Miodu p.1 - sala 1","5395":"Kopalnia Kapiącego Miodu p.2 - sala Owadziej Matki","5396":"Kopalnia Kapiącego Miodu p.1 - sala 2","5397":"Kopalnia Kapiącego Miodu p.2 - sala 1","5398":"Kopalnia Kapiącego Miodu p.2 - sala 2","5399":"Kopalnia Kapiącego Miodu p.3","54":"Kopalnia Latimeria p.3","540":"Izba 8","541":"Izba 9","542":"Izba 10","543":"Izba 11","544":"Izba 12","545":"Izba 13","546":"Izba 14","547":"Izba 15","548":"Izba 16","5489":"Niecka Xiuh Atl (wersja questowa)","549":"Przedsionek Śmierci","5490":"Altepetl Mahoptekan (wersja questowa)","5491":"Przedsionek Quinametzin","55":"Dom Paratoka","553":"Zajazd Umbara p.1","555":"Apartament 101","556":"Apartament 102","557":"Apartament 103","558":"Apartament 104","559":"Apartament 105","56":"Dom Paratoka p.1","560":"Apartament 106","561":"Pokój 201","5614":"Chata","562":"Pokój 202","563":"Pokój 203","5639":"Opuszczona piramida - przedsionek","564":"Pokój 204","5642":"Chata Aptlake (wersja questowa)","565":"Pokój 205","5653":"Złota Góra p.1 - sala 1","5654":"Złota Góra p.1 - sala 2","5655":"Złota Góra p.1 - sala 3","5656":"Złota Góra p.1 - sala 4","5657":"Złota Góra p.2 - sala 1","5658":"Złota Góra p.2 - sala 2","5659":"Złota Góra p.2 - sala 3","566":"Pokój 206","5660":"Złota Góra p.2 - sala 4","5661":"Złota Góra p.3 - sala 1","5662":"Złota Góra p.3 - sala 2","5663":"Oztotl Tzacua p.1 - sala 1","5664":"Oztotl Tzacua p.1 - sala 2","5665":"Oztotl Tzacua p.2 - sala 1","5666":"Oztotl Tzacua p.2 - sala 2","5667":"Oztotl Tzacua p.3 - sala 1","5668":"Oztotl Tzacua p.3 - sala 2","5669":"Oztotl Tzacua p.4 - sala 1","567":"Pokój 207","5670":"Oztotl Tzacua p.4 - sala 2","5671":"Oztotl Tzacua p.5","5672":"Chantli Cuaitla Citlalina","5673":"Chantli","5674":"Chantli","5675":"Chantli","5676":"Chantli","5677":"Wschodni Mictlan p.1","5678":"Wschodni Mictlan p.2","5679":"Wschodni Mictlan p.3","568":"Pokój 208","5680":"Wschodni Mictlan p.4","5681":"Wschodni Mictlan p.5","5682":"Wschodni Mictlan p.6","5683":"Wschodni Mictlan p.7","5684":"Wschodni Mictlan p.8","5685":"Wschodni Mictlan p.9","5686":"Wschodni Axcaitl","5687":"Zachodni Mictlan p.1","5688":"Zachodni Mictlan p.2","5689":"Zachodni Mictlan p.3","569":"Pokój 209","5690":"Zachodni Mictlan p.4","5691":"Zachodni Mictlan p.5","5692":"Zachodni Mictlan p.6","5693":"Zachodni Mictlan p.7","5694":"Zachodni Mictlan p.8","5695":"Zachodni Mictlan p.9","5696":"Topan p.1","5697":"Topan p.2","5698":"Topan p.3","5699":"Topan p.4","57":"Dom Gindera","570":"Pokój 210","5700":"Topan p.5","5701":"Topan p.6","5702":"Topan p.7","5703":"Topan p.8","5704":"Topan p.9","5705":"Topan p.10","5706":"Topan p.11","5707":"Topan p.12","5708":"Topan p.13","5709":"Teotihuacan - przedsionek","571":"Pokój 211","5710":"Teotihuacan","572":"Pokój 212","573":"Pokój 213","5730":"Spichlerz Chochoła (poziom: normalny)","5731":"Spichlerz Chochoła (poziom: trudny)","5732":"Spichlerz Chochoła (poziom: mistrzowski)","5733":"Przeklęta Strażnica","5734":"Przeklęta Strażnica p.1","5735":"Przeklęta Strażnica p.2","5736":"Przeklęta Strażnica - podziemia p.1 s.1","5737":"Przeklęta Strażnica - podziemia p.1 s.2","5738":"Przeklęta Strażnica - podziemia p.2 s.1","5739":"Przeklęta Strażnica - podziemia p.2 s.2","574":"Nithal","5740":"Przeklęta Strażnica - podziemia p.2 s.3","5741":"Grzybowa Grota - wyjście","5744":"Posterunek straży Werbin","575":"Podgrodzie Nithal","576":"Zapomniana Ścieżyna","58":"Dom Idropusa","580":"Grota Dzikiego Kota","581":"Jaskinia Wilczego Zamętu p.1","582":"Jaskinia Wilczego Zamętu p.2","583":"Grota Malowanej Śmierci","5847":"Grota Orczych Szamanów p.1 s.1","5848":"Grota Orczych Szamanów p.1 s.2","5849":"Grota Orczych Szamanów p.2 s.1","5850":"Grota Orczych Szamanów p.2 s.2","5851":"Grota Orczych Szamanów p.3 s.1","5852":"Grota Orczej Hordy p.1 s.1","5853":"Grota Orczej Hordy p.1 s.2","5854":"Grota Orczej Hordy p.2 s.1","5855":"Grota Orczej Hordy p.2 s.2","5856":"Grota Orczej Hordy p.2 s.3","5857":"Nawiedzone Komnaty - przedsionek","5858":"Sala Dowódcy Orków","5859":"Nawiedzone Komnaty - zachód","5860":"Nawiedzone Komnaty - wschód","5861":"Sala Rady Orków","5862":"Sala Królewska","5863":"Komnaty Czarnej Gwardii - zachód","5864":"Komnaty Czarnej Gwardii - wschód","5865":"Komnata Czarnej Perły","5866":"Nawiedzone Kazamaty p.1 s.1","5867":"Nawiedzone Kazamaty p.1 s.2","5868":"Nawiedzone Kazamaty p.2 s.1","5869":"Nawiedzone Kazamaty p.2 s.2","5870":"Nawiedzone Kazamaty p.3 s.1","5871":"Nawiedzone Kazamaty p.3 s.2","5872":"Nawiedzone Kazamaty p.4","5873":"Rozstaje Wątpiących","5875":"Karczma pod Złośliwym Chochlikiem","589":"Tuzmer","59":"Dom Idropusa p.1","590":"Przejście Lodowatego Wiatru","591":"Sala Lodowatego Wiatru","592":"Przejście Magicznego Mrozu","593":"Sala Magicznego Mrozu","5938":"Przedsionek Kultu","5939":"Mroczne Komnaty","594":"Przejście Zamarzniętych Kości","5940":"Przerażające Sypialnie","5941":"Tajemnicza Siedziba","5942":"Sala Spowiedzi Konających","5943":"Sala Tysiąca Świec","5944":"Lochy Kultu","5945":"Sale Rozdzierania","5946":"Korytarz Ostatnich Nadziei","5947":"Komnata Krwawych Obrzędów","5948":"Skarpiska Tolloków","595":"Sala Zamarzniętych Kości","597":"Siedlisko Szczurów p.1","598":"Siedlisko Szczurów p.2","5982":"Ruiny Tass Zhil","5983":"Błota Sham Al","5984":"Głusza Świstu","5985":"Las Porywów Wiatru","5986":"Kwieciste Kresy","5987":"Rozlewisko Kai","5988":"Gvar Hamryd","5989":"Matecznik Szelestu","599":"Bagna Chojraków","6":"Baraki p.1","60":"Dom Jalena i Tafii","600":"Nizina Wieśniaków","6049":"Krypty Bezsennych p.1 s.1","6050":"Krypty Bezsennych p.1 s.2","6051":"Krypty Bezsennych p.2 s.1","6052":"Krypty Bezsennych p.2 s.2","6053":"Krypty Bezsennych p.3","6054":"Drzewo Dusz p.1","6055":"Drzewo Dusz p.2","6056":"Grota Arbor s.1","6057":"Grota Arbor s.2","6058":"Źródło Wspomnień","6059":"Jaskinia Suchych Pędów s.1","6060":"Jaskinia Suchych Pędów s.2","6061":"Jaskinia Suchych Pędów s.3","6062":"Jaskinia Suchych Pędów s.4","6063":"Drzewo Życia p.1","6064":"Drzewo Życia p.2","6065":"Drzewo Życia p.3","61":"Dom Jalena i Tafii p.1","610":"Dom Aukcyjny","611":"Dom Młynarza","612":"Dom Młynarza p.1","613":"Dom Rózi","614":"Dom Rózi p.1","615":"Dom Rózi - piwnica","616":"Młyn p.2","617":"Młyn p.1","618":"Młyn","619":"Dom Edny","62":"Karczma pod Fioletowym Kryształem","620":"Dom Edny - piwnica p.1","622":"Dom Almonda","623":"Dom Almonda p.1","624":"Kamienica Uliany i Arsena","625":"Kamienica Uliany i Arsena p.1","626":"Kamienica Uliany i Arsena p.2","627":"Zajazd pod Tęczowym Żukiem","628":"Zajazd pod Tęczowym Żukiem - piwnica","629":"Mieszkanie właściciela zajazdu p.1","63":"Karczma pod Fioletowym Kryształem p.1","630":"Port Tuzmer","631":"Dziewicza Knieja","632":"Las Tropicieli","633":"Przejście Myśliwych p.1","634":"Przejście Myśliwych p.2","635":"Dom Uzdrowień","636":"Zajazd u Makiny p.1","6363":"Dom Pinkertonów","637":"Zajazd u Makiny p.2","638":"Zajazd u Makiny - strych","639":"Pokój 1","64":"Dom Enoliana","640":"Pokój 2","641":"Pokój 3","642":"Pokój 4","643":"Pokój 5","644":"Pokój 6","645":"Pokój 101","646":"Pokój 7","647":"Pokój 8","6473":"Grota Bezszelestnych Kroków - sala 1","6474":"Grota Bezszelestnych Kroków - sala 2","6475":"Grota Bezszelestnych Kroków - sala 3","6476":"Więzienie Demonów","6477":"Jaskinia Ulotnych Wspomnień","648":"Pokój 9","6484":"Zachodnia Ćwiartka","6485":"Saloon","649":"Pokój 10","65":"Dom Alabraskana","650":"Pokój 11","651":"Pokój 12","6517":"Kryjówka Potwornego Kicaja (poziom: normalny)","6518":"Kryjówka Potwornego Kicaja (poziom: trudny)","6519":"Kryjówka Potwornego Kicaja (poziom: mistrzowski)","652":"Pokój 113","6523":"Kopalnia Krwawej Zemsty","6524":"Kopalnia Krwawej Pychy","6525":"Kopalnia Krwawego Szaleństwa","6526":"Kopalnia Krwawego Opętania","6527":"Kopalnia Krwawej Arogancji","653":"Pokój 102","6535":"Kamienna Jaskinia - sala 1","6536":"Kamienna Jaskinia - sala 2","6537":"Kamienna Jaskinia - sala 3","654":"Pokój 103","6540":"Mrówcza Kolonia p.1 - lewy tunel","6541":"Mrówcza Kolonia p.1 - prawy tunel","6542":"Mrówcza Kolonia p.2 - lewe korytarze","6543":"Mrówcza Kolonia p.2 - prawe korytarze","6544":"Mrówcza Kolonia p.3 - lewa komora jaj","6545":"Mrówcza Kolonia p.3 - prawa komora jaj","6546":"Mrówcza Kolonia p.4 - królewskie gniazdo","6549":"Dom Strachów i Dziwów","655":"Pokój 104","6553":"Gabinet Luster","656":"Pokój 105","657":"Pokój 106","658":"Pokój 107","659":"Pokój 108","66":"Dom Mira","660":"Pokój 109","6608":"Świątynia Andarum","6609":"Świątynia Andarum - zejście lewe","661":"Pokój 110","6610":"Świątynia Andarum - zejście prawe","6611":"Świątynia Andarum - podziemia","6612":"Świątynia Andarum - biblioteka","6613":"Świątynia Andarum - magazyn p.1","6614":"Świątynia Andarum - magazyn p.2","6615":"Świątynia Andarum - zbrojownia","6616":"Świątynia Andarum - lokum mnichów","6617":"Erem Czarnego Słońca p.1 - północ","6618":"Erem Czarnego Słońca p.2","6619":"Erem Czarnego Słońca p.3","662":"Pokój 111","6620":"Erem Czarnego Słońca p.4 - sala 1","6621":"Erem Czarnego Słońca p.4 - sala 2","6622":"Erem Czarnego Słońca p.3 - południe","6623":"Erem Czarnego Słońca p.5","6624":"Krypty Dusz Śniegu p.1","6625":"Krypty Dusz Śniegu p.2","6626":"Krypty Dusz Śniegu p.3","6627":"Krypty Dusz Śniegu p.3 - komnata Lisza","6628":"Zdradzieckie Przejście p.1","6629":"Zdradzieckie Przejście p.2","663":"Pokój 201","6630":"Głębokie Skałki p.1","6631":"Głębokie Skałki p.2","6632":"Głębokie Skałki p.3","6633":"Głębokie Skałki p.4","6634":"Wylęgarnia Choukkerów p.1","6635":"Wylęgarnia Choukkerów p.2","6636":"Wylęgarnia Choukkerów p.3","6637":"One Night Casino","6638":"One Night Casino - zapomniana sala (poziom: normalny)","664":"Pokój 114","6640":"One Night Casino - zapomniana sala (poziom: trudny)","6642":"One Night Casino - zapomniana sala (poziom: mistrzowski)","6644":"Wyspa Ahiko","6645":"Wyspa Ahiko - Miasto Małp","6646":"Przedsionek Konga Ka","6647":"Komnata Konga Ka (poziom: normalny)","6648":"Komnata Konga Ka (poziom: trudny)","6649":"Komnata Konga Ka (poziom: mistrzowski)","665":"Pokój 115","6651":"Przedsionek Konga Go","6652":"Komnata Konga Go (poziom: normalny)","6653":"Komnata Konga Go (poziom: trudny)","6654":"Komnata Konga Go (poziom: mistrzowski)","6656":"Przedsionek Konga La","6657":"Komnata Konga La (poziom: normalny)","6658":"Komnata Konga La (poziom: trudny)","6659":"Komnata Konga La (poziom: mistrzowski)","666":"Pokój 116","6661":"Przedsionek Konga Ho","6662":"Komnata Konga Ho (poziom: normalny)","6663":"Komnata Konga Ho (poziom: trudny)","6664":"Komnata Konga Ho (poziom: mistrzowski)","6666":"Przedsionek Konga Bo","6667":"Komnata Konga Bo (poziom: normalny)","6668":"Komnata Konga Bo (poziom: trudny)","6669":"Komnata Konga Bo (poziom: mistrzowski)","667":"Pokój 117","6671":"Przedsionek Konga Ha","6672":"Komnata Konga Ha (poziom: normalny)","6673":"Komnata Konga Ha (poziom: trudny)","6674":"Komnata Konga Ha (poziom: mistrzowski)","6676":"Przedsionek Konga Hin","6677":"Komnata Konga Hin (poziom: normalny)","6678":"Komnata Konga Hin (poziom: trudny)","6679":"Komnata Konga Hin (poziom: mistrzowski)","668":"Pokój 118","669":"Pokój 119","67":"Dom Mira p.1","670":"Pokój 120","671":"Pokój 121","672":"Pokój 122","673":"Pokój 123","674":"Pokój 124","675":"Pokój 112","676":"Pokój 214","677":"Pokój 202","6770":"Szyb transportowy","6771":"Labirynt Margorii","6772":"Kopalnia Margorii","6773":"Margoria","6774":"Margoria - Sala Królewska","6775":"Szyb Zdrajców","6776":"Ślepe Wyrobisko","6777":"Zagrzybiałe Ścieżki p.1 - sala 1","6778":"Zagrzybiałe Ścieżki p.1 - sala 2","6779":"Zagrzybiałe Ścieżki p.1 - sala 3","678":"Pokój 203","6780":"Zagrzybiałe Ścieżki p.2","6781":"Zagrzybiałe Ścieżki p.3","6782":"Miasteczko Deadlow","6783":"Grota Zeszłorocznych Dyń (poziom: normalny)","6784":"Grota Zeszłorocznych Dyń (poziom: trudny)","6785":"Grota Zeszłorocznych Dyń (poziom: mistrzowski)","6789":"Karczma pod Zgniłą Dynią","679":"Pokój 204","6790":"Hotel u Cecylii - lobby","6796":"Hotel u Cecylii - piętro 1","68":"Dom Galisa","680":"Pokój 205","6803":"Hotel u Cecylii - piętro 2","681":"Pokój 206","682":"Pokój 207","683":"Pokój 208","684":"Pokój 209","685":"Pokój 210","6853":"Miasteczko Cukrowiec","6854":"Fabryka Słodki Amok - hala główna","6855":"Fabryka Słodki Amok - gabinet","6856":"Fabryka Słodki Amok - hala produkcyjna","6857":"Dom handlowy","6858":"Zaśnieżony trakt","6859":"Obóz biedoty","686":"Pokój 211","6862":"Dom Medina","687":"Pokój 212","688":"Pokój 213","689":"Pokój 215","69":"Dom Szagarata","690":"Pokój 216","691":"Pokój 217","692":"Pokój 218","6921":"Grota Zeszłorocznych Łakoci (poziom: normalny)","6922":"Grota Zeszłorocznych Łakoci (poziom: trudny)","6923":"Grota Zeszłorocznych Łakoci (poziom: mistrzowski)","6924":"Lodowy park","693":"Pokój 219","6934":"Podziemia Zniszczonej Wieży p.1","6935":"Podziemia Zniszczonej Wieży p.2","6936":"Podziemia Zniszczonej Wieży p.3","6937":"Podziemia Zniszczonej Wieży p.4","6938":"Podziemia Zniszczonej Wieży p.5","6939":"Zabłocona Jama p.1 - sala 1","694":"Pokój 220","6940":"Zabłocona Jama p.1 - sala 2","6941":"Zabłocona Jama p.2 - sala 1","6942":"Zabłocona Jama p.2 - sala 2","6943":"Zabłocona Jama p.2 - sala 3","6944":"Zabłocona Jama p.2 - Sala Błotnistych Odmętów","6945":"Zabłocona Jama p.2 - Sala Duszącej Stęchlizny","6946":"Zabłocona Jama p.2 - Sala Magicznego Błota","6947":"Chata bandytów","6948":"Chata bandytów p.1","6949":"Bandyckie Chowisko","695":"Pokój 221","6950":"Bandyckie Chowisko - skarbiec","6951":"Siedziba rekieterów","6952":"Siedziba rekieterów p.1","6953":"Kopalnia Żółtego Kruszcu p.1 - sala 1","6954":"Kopalnia Żółtego Kruszcu p.1 - sala 2","6955":"Kopalnia Żółtego Kruszcu p.2 - sala 1","6956":"Kopalnia Żółtego Kruszcu p.2 - sala 2","696":"Pokój 222","697":"Pokój 223","698":"Pokój 224","6982":"Wielkanocny Babi Wzgórek","6986":"Lezysko Baraniego Kanoniera (poziom: normalny)","6987":"Lezysko Baraniego Kanoniera (poziom: trudny)","6988":"Lezysko Baraniego Kanoniera (poziom: mistrzowski)","6989":"Chata Teściowej","699":"Pokój 225","6990":"Góralski magazyn","7":"Ratusz Ithan","70":"Zajazd Umbara","700":"Pokój 226","701":"Sosnowe Odludzie","702":"Zapomniany Grobowiec p.2","703":"Zapomniany Grobowiec p.3","704":"Zapomniany Grobowiec p.4","705":"Zapomniany Grobowiec p.5","7055":"Wulkan Politraki p.1 - sala 1","7056":"Wulkan Politraki p.1 - sala 2","7057":"Wulkan Politraki p.1 - sala 3","7058":"Wulkan Politraki p.2 - sala 1","7059":"Wulkan Politraki p.2 - sala 2","7060":"Wulkan Politraki - przedsionek","7061":"Wulkan Politraki - Piekielne Czeluście","7062":"Grobowiec Nieznających Spokoju","7063":"Skalne Cmentarzysko p.1","7064":"Skalne Cmentarzysko p.2","7065":"Skalne Cmentarzysko p.3","7066":"Skalne Cmentarzysko p.4","7067":"Piramida Pustynnego Władcy p.1","7068":"Piramida Pustynnego Władcy p.2","7069":"Piramida Pustynnego Władcy p.3","707":"Ruiny Szabrowników","7070":"Grota Trzeszczących Kości p.1 - sala 1","7071":"Grota Trzeszczących Kości p.1 - sala 2","7072":"Mgliste Kurkany","7073":"Leśne bagnisko","7074":"Zagrzybiały Kurkan","7075":"Zagrzybiały Kurkan","7076":"Zagrzybiały Kurkan","7098":"Chata studentów","71":"Dom Moliwii","7115":"Kopalnia Krwawej Zemsty - pułapka","7116":"Kopalnia Krwawej Pychy - pułapka","7117":"Kopalnia Krwawego Szaleństwa - pułapka","7118":"Kopalnia Krwawego Opętania - pułapka","7119":"Kopalnia Krwawej Arogancji - pułapka","7128":"Akhetaten","7129":"Przedsionek piramidy Bastet","713":"Kamienica Uliany i Arsena - piwnica p.1","7130":"Piramida Bastet (poziom: normalny)","7131":"Piramida Bastet (poziom: trudny)","7132":"Piramida Bastet (poziom: mistrzowski)","7133":"Wakacyjna piramida Bastet","7134":"Przedsionek piramidy Anubisa","7135":"Piramida Anubisa (poziom: normalny)","7136":"Piramida Anubisa (poziom: trudny)","7137":"Piramida Anubisa (poziom: mistrzowski)","7138":"Wakacyjna piramida Anubisa","7139":"Przedsionek piramidy Izydy","7140":"Piramida Izydy (poziom: normalny)","7141":"Piramida Izydy (poziom: trudny)","7142":"Piramida Izydy (poziom: mistrzowski)","7143":"Wakacyjna piramida Izydy","7144":"Przedsionek piramidy Ptaha","7145":"Piramida Ptaha (poziom: normalny)","7146":"Piramida Ptaha (poziom: trudny)","7147":"Piramida Ptaha (poziom: mistrzowski)","7148":"Wakacyjna piramida Ptaha","7149":"Przedsionek piramidy Renenutet","7150":"Piramida Renenutet (poziom: normalny)","7151":"Piramida Renenutet (poziom: trudny)","7152":"Piramida Renenutet (poziom: mistrzowski)","7153":"Wakacyjna piramida Renenutet","7154":"Przedsionek piramidy Tota","7155":"Piramida Tota (poziom: normalny)","7156":"Piramida Tota (poziom: trudny)","7157":"Piramida Tota (poziom: mistrzowski)","7158":"Wakacyjna piramida Tota","7159":"Przedsionek piramidy Ra","7160":"Piramida Ra (poziom: normalny)","7161":"Piramida Ra (poziom: trudny)","7162":"Piramida Ra (poziom: mistrzowski)","7163":"Wakacyjna piramida Ra","72":"Dom Moliwii p.1","725":"Las Goblinów","726":"Morwowe Przejście","7267":"SP Margonem - sala bankietowa","727":"Podmokła Dolina","7271":"SP Margonem - składzik bagażowy (poziom: normalny)","7272":"SP Margonem - mostek kapitański","7273":"SP Margonem - klatka schodowa p.3","7274":"SP Margonem - kuchnia","7275":"SP Margonem - kasyno","7276":"SP Margonem - sala operowa","7277":"SP Margonem - klatka schodowa p.2","7278":"SP Margonem - pokój pierwszej klasy","7279":"SP Margonem - pokój pierwszej klasy","7280":"SP Margonem - pokój pierwszej klasy","7281":"SP Margonem - pokój pierwszej klasy","7282":"SP Margonem - pokój pierwszej klasy","7283":"SP Margonem - pokój pierwszej klasy","7284":"SP Margonem - klatka schodowa p.1","7285":"SP Margonem - pokój drugiej klasy","7286":"SP Margonem - pokój drugiej klasy","7287":"SP Margonem - pokój drugiej klasy","7289":"SP Margonem - pokój drugiej klasy","7290":"SP Margonem - pokój drugiej klasy","7291":"SP Margonem - pokój drugiej klasy","7292":"SP Margonem - pokój drugiej klasy","7293":"SP Margonem - pokój załogi","7294":"SP Margonem - korytarz techniczny","7295":"SP Margonem - maszynownia","7296":"SP Margonem - luki bagażowe","7297":"SP Margonem - taras","73":"Zielna Grota p.1 - sala 1","730":"Zachodnia Rubież","731":"Winnica Meflakasti","732":"Zajazd pod Tęczowym Żukiem p.1","733":"Kamienica Eklektusa","7332":"SP Margonem - składzik bagażowy (poziom: trudny)","7333":"SP Margonem - składzik bagażowy (poziom: mistrzowski)","7334":"Wyjąca Jaskinia","7335":"Góralska Pieczara p.1","7336":"Góralska Pieczara p.2","7337":"Góralska Pieczara p.3","7338":"Chata Teściowej","7339":"Chata wójta Fistuły","734":"Kamienica Eklektusa p.1","7340":"Chata wójta Fistuły p.1","7341":"Kryształowa Grota - przepaść","7342":"Kryształowa Grota p.1","7343":"Kryształowa Grota p.2 - sala 1","7344":"Kryształowa Grota p.2 - sala 2","7345":"Kryształowa Grota - Sala Smutku","7346":"Kryształowa Grota p.3 - sala 1","7347":"Kryształowa Grota p.3 - sala 2","7348":"Kryształowa Grota p.4","7349":"Kryształowa Grota p.5","735":"Kamienica Eklektusa p.2","7350":"Kryształowa Grota p.6","7351":"Piaszczysta Grota p.1 - sala 1","7352":"Piaszczysta Grota p.1 - sala 2","7353":"Głębia Przeklętych Fal - przedsionek","7354":"Głębia Przeklętych Fal - sala","7355":"Jama Morskiej Macki p.1 - sala 1","7356":"Jama Morskiej Macki p.1 - sala 2","7357":"Jama Morskiej Macki p.1 - sala 3","7358":"Korytarze Wygnańców p.1 - Sala Ech","7359":"Korytarze Wygnańców p.1 - Jaskinia Zagubionych","736":"Kamienica Eklektusa - strych","7360":"Korytarze Wygnańców p.1 - Bezdenne Przepaści","7361":"Korytarze Wygnańców p.1 - Komora Opuszczonych","7362":"Korytarze Wygnańców p.1 - Hala Odszczepieńców","7363":"Korytarze Wygnańców p.1 - Sala Szlachetnych","7364":"Korytarze Wygnańców p.2 - Sala Żądzy","7365":"Korytarze Wygnańców p.2 - Komora Budowniczego","7366":"Korytarze Wygnańców p.2 - Komnata Wygnańców","7367":"Korytarze Wygnańców p.3 - Komnata Przeklętego Daru","7368":"Twierdza Rogogłowych - Sala Byka","7369":"Opuszczony statek - pokład pod rufą","737":"Kamienica Andronikusa","7370":"Opuszczony statek - pokład","7371":"Piaskowa Pułapka p.1 - sala 1","7372":"Piaskowa Pułapka p.1 - sala 2","7373":"Piaskowa Pułapka p.1 - sala 3","7374":"Piaskowa Pułapka p.1 - sala 4","7375":"Piaskowa Pułapka - Grota Piaskowej Śmierci","7378":"Chatka Mikołaja","7379":"Internat","738":"Kamienica Andronikusa p.1","739":"Kamienica Andronikusa - strych","74":"Zielna Grota p.1 - sala 2","740":"Kamienica Prokusi","7406":"Jaskinia Łowców p.1 - świąteczna kryjówka (poziom: normalny)","7407":"Jaskinia Łowców p.1 - świąteczna kryjówka (poziom: trudny)","7408":"Jaskinia Łowców p.1 - świąteczna kryjówka (poziom: mistrzowski)","741":"Kamienica Prokusi p.1","742":"Kamienica Prokusi p.2","7423":"Teatr Monticolo - foyer","7424":"Teatr Monticolo - sala teatralna","7425":"Teatr Monticolo - kulisy lewe","7426":"Teatr Monticolo - kulisy prawe","7427":"Teatr Monticolo - korytarz","7428":"Teatr Monticolo - garderoba","7429":"Teatr Monticolo - garderoba","743":"Kamienica Nitrusa","7430":"Teatr Monticolo - garderoba","7431":"Teatr Monticolo - wejście od zaplecza","744":"Kamienica Nitrusa p.1","7440":"Mała Twierdza - sala wejściowa","7441":"Mała Twierdza - sala główna","7442":"Mała Twierdza p.1","7443":"Mała Twierdza - korytarz zachodni","7444":"Mała Twierdza - mury zachodnie","7445":"Mała Twierdza - wieża zachodnia","7446":"Mała Twierdza - mury wschodnie","7447":"Mała Twierdza - wieża wschodnia","7448":"Mała Twierdza - magazyn","7449":"Mała Twierdza - mały barak","745":"Kamienica Nitrusa p.2","7450":"Mała Twierdza - wieża strażnicza","7451":"Mała Twierdza - podziemny magazyn","7452":"Cenotaf Berserkerów - przejście przodków","7453":"Cenotaf Berserkerów p.1 - sala 1","7454":"Cenotaf Berserkerów p.1 - sala 2","7455":"Chodniki Mrinding","7456":"Chodniki Mrinding p.1 - sala 1","7457":"Chodniki Mrinding p.1 - sala 2","7458":"Chodniki Mrinding p.2 - sala 1","7459":"Chodniki Mrinding p.2 - sala 2","7460":"Ścieżki Erebeth p.2 - sala 1","7461":"Ścieżki Erebeth p.2 - sala 2","7462":"Ścieżki Erebeth p.3","7463":"Kuźnia Worundriela p.1","7464":"Kuźnia Worundriela p.2","7465":"Kuźnia Worundriela p.3","7466":"Kuźnia Worundriela - Komnata Żaru","7467":"Ognista Studnia p.1","7468":"Ognista Studnia p.2","7469":"Ognista Studnia p.3","747":"Kamienica Tamena","7470":"Lokum Złych Goblinów - wieża","7471":"Lokum Złych Goblinów - zejście p.1","7472":"Lokum Złych Goblinów p.2 - sala 1","7473":"Lokum Złych Goblinów p.2 - sala 2","7474":"Lokum Złych Goblinów - warsztat","7475":"Lokum Złych Goblinów p.3 - sala 1","7476":"Lokum Złych Goblinów p.3 - sala 2","7477":"Lokum Złych Goblinów p.4","7478":"Lokum Złych Goblinów - pracownia","7479":"Gryforium","748":"Kamienica Tamena p.1","7480":"Korytarze Milczących Intryg p.1","7481":"Korytarze Milczących Intryg p.2 - sala 1","7482":"Korytarze Milczących Intryg p.2 - sala 2","7483":"Korytarze Milczących Intryg p.3","7484":"Sala Ukrytych Paktów","749":"Kamienica Tamena p.2","750":"Kamienica Tamena - piwnica","751":"Kamienica Broka","752":"Kamienica Broka p.1","753":"Kamienica Broka p.2","754":"Kamienica Broka - strych","755":"Kamienica Broka - piwnica","756":"Kamienica Miona","757":"Kamienica Miona p.1","758":"Kamienica Miona p.2","76":"Dom Alrika","760":"Kamienica Uliany i Arsena - piwnica p.2","761":"Kamienica Tanenbara","762":"Kamienica Tanenbara p.1","763":"Kamienica Tanenbara p.2","7639":"Kopalnia Krwawego Opętania - przedsionek","764":"Kamienica Tanenbara - piwnica","765":"Ratusz Ithan - skarbiec","7651":"Polana Strażnika","766":"Ratusz Ithan p.1","767":"Kamienica Lukrecji","768":"Kamienica Lukrecji p.1","7680":"Zbocze Starych Bogów","7681":"Bezgwiezdna Gęstwina","7682":"Bór Zagubionych","7683":"Martwy Las","7684":"Ziemia Szepczących Cierni","7685":"Grota Skamieniałej Kory p.1 - sala 1","7686":"Grota Skamieniałej Kory p.1 - sala 2","7687":"Grota Skamieniałej Kory p.2","7688":"Starodrzew Przedwiecznych p.1","7689":"Starodrzew Przedwiecznych p.2","7690":"Ogrza Kawerna p.1","7691":"Ogrza Kawerna p.2","7692":"Ogrza Kawerna p.3","7693":"Ogrza Kawerna p.4","7694":"Przejście Oczyszczenia","7695":"Sala Skaryfikacji Grzeszników","7696":"Kanały Nithal p.1 - sala 1","7697":"Kanały Nithal p.1 - sala 2","7698":"Kanały Nithal p.1 - sala 3","7699":"Szlamowe Kanały p.2 - sala 1","77":"Dom Alrika p.1","770":"Kwatera żołnierska","7700":"Szlamowe Kanały p.2 - sala 2","7701":"Szlamowe Kanały p.2 - sala 3","7702":"Głębokie Katakumby - labirynt","7703":"Głębokie Katakumby - labirynt","7704":"Głębokie Katakumby - labirynt","7705":"Głębokie Katakumby - labirynt","7706":"Głębokie Katakumby - labirynt","7707":"Głębokie Katakumby - labirynt","7708":"Głębokie Katakumby - labirynt","7709":"Głębokie Katakumby - labirynt","771":"Kwatera żołnierska p.1","7710":"Głębokie Katakumby - labirynt","7711":"Głębokie Katakumby - labirynt","7712":"Głębokie Katakumby - labirynt","7713":"Głębokie Katakumby - skarbiec","7714":"Tortuga","7715":"Pokład łodzi Allisona","7716":"Grota Kolgi (poziom: normalny)","7717":"Grota Kolgi (poziom: trudny)","7718":"Grota Kolgi (poziom: mistrzowski)","7719":"Wakacyjna Grota Kolgi","772":"Kwatera żołnierska p.2","7720":"Pokład łodzi Allisona","7721":"Grota Duvy (poziom: normalny)","7722":"Grota Duvy (poziom: trudny)","7723":"Grota Duvy (poziom: mistrzowski)","7724":"Wakacyjna Grota Duvy","7725":"Pokład łodzi Allisona","7726":"Grota Blodughaddy (poziom: normalny)","7727":"Grota Blodughaddy (poziom: trudny)","7728":"Grota Blodughaddy (poziom: mistrzowski)","7729":"Wakacyjna Grota Blodughaddy","773":"Kwatera żołnierska - piwnica p.1","7730":"Pokład łodzi Allisona","7731":"Grota Bary (poziom: normalny)","7732":"Grota Bary (poziom: trudny)","7733":"Grota Bary (poziom: mistrzowski)","7734":"Wakacyjna Grota Bary","7735":"Pokład łodzi Allisona","7736":"Grota Unn (poziom: normalny)","7737":"Grota Unn (poziom: trudny)","7738":"Grota Unn (poziom: mistrzowski)","7739":"Wakacyjna Grota Unn","774":"Kwatera żołnierska - piwnica p.2","7740":"Pokład łodzi Allisona","7741":"Grota Himinglavy (poziom: normalny)","7742":"Grota Himinglavy (poziom: trudny)","7743":"Grota Himinglavy (poziom: mistrzowski)","7744":"Wakacyjna Grota Himinglavy","7745":"Pokład łodzi Allisona","7746":"Grota Hronn (poziom: normalny)","7747":"Grota Hronn (poziom: trudny)","7748":"Grota Hronn (poziom: mistrzowski)","7749":"Wakacyjna Grota Hronn","775":"Kwatera żołnierska","7751":"Lazaret","7752":"Speluna","776":"Kwatera żołnierska p.1","777":"Kwatera żołnierska p.2","778":"Kwatera żołnierska - piwnica","779":"Kwatera żołnierska","78":"Dom Idalii","780":"Kwatera żołnierska p.1","7802":"Miasteczko Deadlow","7803":"Grota Zeszłorocznych Dyń","7804":"Labirynt w polu kukurydzy","781":"Kwatera żołnierska - piwnica","782":"Kamienica Rewii","7824":"Mglisty Las","7825":"Grząska Ziemia","7826":"Bagna Umarłych","7827":"Gnijące Topielisko","7828":"Dolina Pełznącego Krzyku","7829":"Zatrute Torfowiska","783":"Kamienica Rewii p.1","7830":"Zawodzące Kaskady","7831":"Strumienie Szemrzących Wód","7832":"Złota Dąbrowa","7833":"Dolina Potoku Śmierci","7834":"Skryty Azyl","7835":"Jaszczurze Korytarze p.1 - sala 1","7836":"Jaszczurze Korytarze p.1 - sala 2","7837":"Jaszczurze Korytarze p.1 - sala 3","7838":"Jaszczurze Korytarze p.1 - sala 4","7839":"Jaszczurze Korytarze p.2 - sala 1","784":"Kamienica Rewii - piwnica","7840":"Jaszczurze Korytarze p.2 - sala 2","7841":"Jaszczurze Korytarze p.2 - sala 3","7842":"Jaszczurze Korytarze p.2 - sala 4","7843":"Jaszczurze Korytarze p.2 - sala 5","7844":"Mechata Jama p.1","7845":"Mechata Jama p.2","7846":"Mechata Jama p.3","7847":"Nora Jaszczurzych Koszmarów p.1 - sala 1","7848":"Nora Jaszczurzych Koszmarów p.1 - sala 2","7849":"Nora Jaszczurzych Koszmarów - źródło","785":"Dom Rezarda","7850":"Grota Porośniętych Stalagmitów p.1 - sala 1","7851":"Grota Porośniętych Stalagmitów p.1 - sala 2","7852":"Grota Porośniętych Stalagmitów p.2 - sala 1","7853":"Grota Porośniętych Stalagmitów p.2 - sala 2","7854":"Zakazana Grota","7855":"Porzucone Noiridum p.2","7856":"Porzucone Noiridum p.3 - sala 1","7857":"Porzucone Noiridum p.3 - sala 2","7858":"Porzucone Noiridum p.3 - sala 3","7859":"Erem Aldiphrina","786":"Dom Rezarda - kuchnia","7860":"Dawny Przełaz","7861":"Zapomniane Sztolnie","7862":"Zamierzchłe Arterie p.2 - sala 1","7863":"Zamierzchłe Arterie p.2 - sala 2","7864":"Ołtarz Pajęczej Bogini","7865":"Zamierzchłe Arterie p.3","787":"Dom Rezarda - biblioteka","788":"Dom Rezarda - piwnica p.1","789":"Dom Rezarda - piwnica p.2","79":"Dom Idalii p.1","790":"Dom Rezarda - piwnica p.3","791":"Kamienica Nandraroka","792":"Kamienica Nandraroka p.1","793":"Kamienica Nandraroka p.2","794":"Kamienica Nandraroka - piwnica p.1","795":"Kamienica Nandraroka - piwnica p.2","796":"Kamienica Cecylii","797":"Kamienica Cecylii p.1","798":"Kamienica Cecylii p.2","799":"Kamienica Cecylii p.3","8":"Zniszczone Opactwo","80":"Dom Sary","800":"Kamienica Cecylii - pokój Elizki","802":"Kamienica Krynii Lufis","803":"Kamienica Krynii Lufis p.1","804":"Kamienica Krynii Lufis p.2","805":"Kamienica Krynii Lufis p.3","806":"Kamienica Krynii Lufis - piwnica p.1","807":"Kamienica Krynii Lufis - piwnica p.2","808":"Kamienica Krynii Lufis - piwnica p.3","809":"Kopalnia Krynii Lufis","81":"Dom Sary - piwnica","810":"Kamienica Pireza","811":"Kamienica Pireza p.1","8116":"Gwiazdkowa Osada Zamrozy","8117":"Gwiazdkowe Włości Mikołaja","8118":"Dom Janiny i Mariana","8119":"Dom Edwarda","812":"Kamienica Pireza p.2","8120":"Dom Emilio","8121":"Dom Karoliny i Gabriela","8122":"Dom Darii i Kacpra","8123":"Dom Haliny i Antoniego","8124":"Dom Joli i Marka","8125":"Dom Marty i Jana","8126":"Dom Pałcia i Gałcia - parter","8127":"Dom Pałcia i Gałcia - piętro","8128":"Dom babci Hani","8129":"Dom babci Hani - sypialnia","813":"Kamienica Pireza - gołębnik","8130":"Dom Janiny i Mariana - pokój Edzia","8131":"Dom Edwarda p.1","8132":"Dom babci Hani - strych","814":"Lazurytowa Grota p.1","8145":"Dom Mikołaja - pracownia","8147":"Dom Mikołaja - magazyn","815":"Lazurytowa Grota p.2","8154":"Stajnia reniferów","8155":"Dom drwala Gienka","816":"Lazurytowa Grota p.3 - sala 2","8165":"Jaskinia Lodowego Chaosu","8166":"Gęste Sploty","8167":"Zmurszały Łęg","8168":"Garb Połamanych Konarów","8169":"Zalesiony Step","817":"Izba chorych płn.","8171":"Głusza Srebrnego Rogu","8172":"Knieja Lunarnych Głazów","8173":"Szepty Menhirów","8174":"Gaj Księżycowego Blasku","8175":"Zakątek Nocnych Szelestów","8176":"Zarosłe Szczeliny p.1 - sala 1","8177":"Zarosłe Szczeliny p.1 - sala 2","8178":"Zarosłe Szczeliny p.1 - sala 3","8179":"Gardziel Podgnitych Mchów p.1","818":"Izba chorych płn. p.1","8180":"Gardziel Podgnitych Mchów p.2","8181":"Gardziel Podgnitych Mchów p.3","8182":"Zacienione Wnęki p.1 - sala 1","8183":"Zacienione Wnęki p.1 - sala 2","8184":"Zacienione Wnęki p.2 - sala 1","8185":"Zacienione Wnęki p.2 - sala 2","8186":"Siedlisko Przyjemnej Woni","8187":"Siedlisko Przyjemnej Woni - źródło","8188":"Potępione Zamczysko - łącznik zachodni","8189":"Potępione Zamczysko - łącznik wschodni","819":"Izba chorych płn. p.2","8190":"Potępione Zamczysko - północna komnata","8191":"Potępione Zamczysko - lochy zachodnie p.2","8192":"Potępione Zamczysko - lochy wschodnie p.2","8193":"Potępione Zamczysko - głębokie lochy","8194":"Astralna Enklawa","82":"Dom Wei","820":"Izba chorych płn. - piwnica p.1","8206":"Wymiar Kong Ka - przedsionek","8207":"Wymiar Kong Ka (poziom: normalny)","821":"Izba chorych płn. - piwnica p.2","8210":"Wymiar Mufteroina - przedsionek","8211":"Wymiar Mufteroina (poziom: normalny)","8214":"Wymiar Vaduhosa - przedsionek","8215":"Wymiar Vaduhosa (poziom: normalny)","8218":"Wymiar Hone-onny - przedsionek","8219":"Wymiar Hone-onny (poziom: normalny)","822":"Izba chorych płn. - piwnica p.3","8222":"Wymiar Duvy - przedsionek","8223":"Wymiar Duvy (poziom: normalny)","8226":"Wymiar Tenocha - przedsionek","8227":"Wymiar Tenocha (poziom: normalny)","823":"Izba chorych płd.","8230":"Wymiar Matvesa - przedsionek","8231":"Wymiar Matvesa (poziom: normalny)","824":"Izba chorych płd. p.1","825":"Izba chorych płd. p.2","8255":"Urodzinowa kryjówka","826":"Izba chorych płd. - piwnica p.1","827":"Izba chorych - piwniczne przejście","828":"Izba chorych - piwniczne przejście - piwnica","829":"Knajpa pod Czarnym Tulipanem","830":"Knajpa pod Czarnym Tulipanem p.1","831":"Knajpa pod Czarnym Tulipanem - piwnica p.1","832":"Knajpa pod Czarnym Tulipanem - piwnica p.2","833":"Izba 1","834":"Izba 2","835":"Izba 3","836":"Izba 4","837":"Izba 7","838":"Izba 8","839":"Izba 9","84":"Wichrowe Szczyty","840":"Izba 10","841":"Knajpa pod Czarnym Tulipanem - pokój Lucji","842":"Dom Chlasta","843":"Dom Chlasta p.1","844":"Dom Chlasta - piwnica","845":"Baszta Wilczych Kłów","846":"Pieczara Czaszek","847":"Labirynt Wyklętych p.1","848":"Labirynt Wyklętych p.2 - sala 1","849":"Labirynt Wyklętych p.2 - sala 2","850":"Zakon Białej Lilii - siedziba kapłanek","8506":"Bazar Szperaczy","8507":"Bazar Szperaczy - komnata","851":"Dormitorium - część akolitów","8513":"Podbrzezie","8514":"Dom Wacława i Nawoi","8515":"Dom Ciechomira i Rzepichy","8516":"Dom Bogdana i Bronki","8517":"Dom Dobimira i Przybysławy","8518":"Dom Dobrawy","8519":"Dom Krzesimira","852":"Dormitorium - część akolitów p.1","8523":"Stodoła","853":"Dormitorium - część westalek","8530":"Moczary Rybiego Oka","8531":"Podtopione Młaki","8532":"Źródło Narumi","8533":"Uroczysko Wodnika","8534":"Dolny Bieg","8535":"Starorzecze Narumi","8536":"Las Monolitów","8537":"Jałowa Dolina","8538":"Nieme Góry","8539":"Pękający Żleb","854":"Dormitorium - część westalek p.1","8540":"Kamienne Pustkowie","8541":"Krater Uwięzienia","8542":"Rumowisko Szarych Głazów","8544":"Szepczące Wyrwy p.1 - sala 1","8545":"Szepczące Wyrwy p.1 - sala 2","8546":"Szepczące Wyrwy p.1 - sala 3","8547":"Szepczące Wyrwy p.1 - sala 4","8548":"Szepczące Wyrwy p.2 - sala 1","8549":"Szepczące Wyrwy p.2 - sala 2","855":"Dormitorium - kuchnia","8550":"Szepczące Wyrwy p.2 - sala 3","8551":"Szepczące Wyrwy p.2 - sala 4","8552":"Szepczące Wyrwy p.2 - sala 5","8553":"Szepczące Wyrwy p.2 - sala 6","8554":"Szepczące Wyrwy p.3","8555":"Nocna Pustelnia p.1","8556":"Nocna Pustelnia p.2","856":"Dormitorium - spiżarnia","8560":"Wyspa Mygaard","857":"Dormitorium - piwnica p.1","858":"Dormitorium - piwnica p.2","859":"Dormitorium - piwnica p.3","8597":"Przedsionek krypty Draugra","8598":"Krypta Draugra (poziom: normalny)","8599":"Krypta Draugra (poziom: trudny)","860":"Dormitorium - przejście do świątyni","8600":"Krypta Draugra (poziom: mistrzowski)","8602":"Przedsionek krypty Hildur","8603":"Krypta Hildur (poziom: normalny)","8604":"Krypta Hildur (poziom: trudny)","8605":"Krypta Hildur (poziom: mistrzowski)","8607":"Przedsionek krypty Bjorna","8608":"Krypta Bjorna (poziom: normalny)","8609":"Krypta Bjorna (poziom: trudny)","861":"Akademia wojskowa - stajnia","8610":"Krypta Bjorna (poziom: mistrzowski)","8612":"Przedsionek krypty Gunnhild","8613":"Krypta Gunnhild (poziom: normalny)","8614":"Krypta Gunnhild (poziom: trudny)","8615":"Krypta Gunnhild (poziom: mistrzowski)","8617":"Przedsionek krypty Ingrid","8618":"Krypta Ingrid (poziom: normalny)","8619":"Krypta Ingrid (poziom: trudny)","862":"Akademia wojskowa p.1","8620":"Krypta Ingrid (poziom: mistrzowski)","8622":"Przedsionek krypty Sigurda","8623":"Krypta Sigurda (poziom: normalny)","8624":"Krypta Sigurda (poziom: trudny)","8625":"Krypta Sigurda (poziom: mistrzowski)","8627":"Przedsionek krypty Haakona","8628":"Krypta Haakona (poziom: normalny)","8629":"Krypta Haakona (poziom: trudny)","863":"Akademia wojskowa - piwnica p.1","8630":"Krypta Haakona (poziom: mistrzowski)","8632":"Miasteczko Grauenstadt","864":"Akademia wojskowa - piwnica p.2","8640":"Dom pastora - piwnica","865":"Cytadela","866":"Cytadela p.1","867":"Cytadela p.2","868":"Cytadela p.3","869":"Cytadela - kuchnia","87":"Podziemne Przejście p.1","870":"Cytadela - przejście","874":"Drewutnia - piwnica","875":"Drewutnia","876":"Stodoła","877":"Stodoła p.1","878":"Chlew","879":"Zakon Białej Lilii - piwnica","88":"Podziemne Przejście p.2","880":"Gospodarstwo Łucji i Jana","881":"Gospodarstwo Łucji i Jana - piekarnia","882":"Gospodarstwo Łucji i Jana p.1","883":"Gospodarstwo Łucji i Jana p.1 - sypialnia","884":"Gospodarstwo Łucji i Jana - strych","885":"Gospodarstwo Łucji i Jana - piwnica","886":"Gospodarstwo Łucji i Jana - piwnica piekarni","89":"Podziemne Przejście p.3","890":"Uniwersytet płn.","891":"Uniwersytet płn. p.1 - chemia","892":"Uniwersytet płn. p.1 - gabinety","893":"Uniwersytet płn. p.2","894":"Uniwersytet płn. p.3 - sztuka","895":"Uniwersytet płn. p.3 - prawo","896":"Uniwersytet płn. - piwnica p.1","897":"Uniwersytet płn. - piwnica p.2","898":"Uniwersytet płn. - zaplecze","899":"Uniwersytet płn. p.1 - chemia zaplecze","9":"Werbin","90":"Podziemne Przejście p.4","903":"Uniwersytet płd.","904":"Uniwersytet płd. - biblioteka manuskryptów","905":"Aula Akademii Filmowej","906":"Uniwersytet płd. - piwnica p.1","907":"Uniwersytet płd. - piwnica p.2","908":"Świątynia Czterech Bóstw","909":"Zachodnia piwnica świątynna p.1","91":"Podziemne Przejście p.4 - sala 2","910":"Zachodnia piwnica świątynna p.2","911":"Wschodnia piwnica świątynna p.1","913":"Wschodnia piwnica świątynna p.2","914":"Wschodnia piwnica świątynna p.3","915":"Rezydencja Trafalgar","916":"Rezydencja Trafalgar p.1","917":"Rezydencja Trafalgar p.2","919":"Rezydencja Trafalgar - piwnica p.1","92":"Podziemne Przejście p.4 - sala 3","920":"Rezydencja Trafalgar - piwnica p.2","921":"Rezydencja Trafalgar - tajemniczy pokój","923":"Zajazd pod Złamanym Dukatem","924":"Zajazd pod Złamanym Dukatem - kuchnia","925":"Zajazd pod Złamanym Dukatem - pokój właściciela","926":"Zajazd pod Złamanym Dukatem p.1","927":"Zajazd pod Złamanym Dukatem p.2 - część zachodnia","928":"Zajazd pod Złamanym Dukatem p.2 - część wschodnia","929":"Zajazd pod Złamanym Dukatem p.3 - część zachodnia","93":"Podziemne Przejście p.5","930":"Zajazd pod Złamanym Dukatem p.3 - część wschodnia","931":"Zajazd pod Złamanym Dukatem - piwnica","932":"Komnata 100","933":"Komnata 107","934":"Komnata 101","935":"Komnata 102","936":"Komnata 103","937":"Komnata 108","938":"Komnata 109","939":"Komnata 110","94":"Podziemne Przejście p.6 - sala wyjściowa","940":"Apartament 100","941":"Apartament 200","942":"Apartament 204","943":"Apartament 201","944":"Apartament 203","945":"Apartament 300","946":"Apartament 301","947":"Apartament 304","948":"Apartament 306","949":"Apartament 303","95":"Podziemne Przejście p.6 - sala 2","950":"Apartament 308","952":"Gildia Kupców - część zachodnia","953":"Gildia Kupców - część północna","954":"Gildia Kupców - część wschodnia","955":"Gildia Kupców p.1","956":"Gildia Kupców p.2","957":"Gildia Kupców - piwnica","958":"Północne mury Nithal - część wschodnia","959":"Mury Nithal - Baszta Ogniowa","96":"Podziemne Przejście p.6 - sala 3","960":"Wschodnie mury Nithal","961":"Mury Nithal - Baszta Kolcza","962":"Południowe mury Nithal - część wschodnia","963":"Południowe mury Nithal - część zachodnia","964":"Mury Nithal - Baszta Trwała","965":"Mury Nithal - Baszta Koronna","966":"Zewnętrzne mury Nithal","967":"Szkoła","97":"Podziemne Przejście p.6 - sala 4","970":"Wilcza Grota","978":"Zejście do kanałów","98":"Podziemne Przejście - sala wyjściowa","980":"Knajpa pod Czarnym Tulipanem p.2","981":"Knajpa pod Czarnym Tulipanem p.2 - arena","982":"Izba 5","983":"Izba 6","984":"Izba 11","985":"Izba 12","986":"Izba 13","987":"Izba 14","988":"Izba 15","989":"Izba 16","990":"Izba 17","991":"Izba 18","992":"Izba 19","993":"Izba 20","994":"Izba 21","995":"Izba 22","996":"Izba 23","997":"Izba 24","999":"Pokój 1"};
  const EXP = [{"lvl":18,"name":"Grobowce","maps":["2878","2884","2885","2886","2879","2880","2877"],"npcs":[["Adept",19],["Duża larwa",18],["Gacówka rogata",16],["Skolopendra podziemna",20],["Szabrownik",17],["Trupówka pospolita",15]]},{"lvl":20,"name":"Mrówki","maps":["2491","2522","2523","2528","2529","2783"],"npcs":[["Brązowa mrówka robotnica",19],["Brązowa mrówka tragarz",20],["Brązowa mrówka żołnierz",21]]},{"lvl":21,"name":"Pumy i tygrysy","maps":["580","1108","1060","74","1233","1263","1264","4798"],"npcs":[["Puma",21],["Tygrys",22]]},{"lvl":23,"name":"Niedźwiedzie i nietoperze","maps":["631","1057","583","3","19","143","144","145","146","147","278","633","634","2519","2521","2562","2890","84"],"npcs":[["Gacek szary",25],["Niedźwiadek",22],["Niedźwiedź brunatny",23],["Niedźwiedź czarny",24],["Niedźwiedź szary",24]]},{"lvl":26,"name":"Bazyliszki","maps":["632"],"npcs":[["Kamienny bazyliszek",27],["Leśny bazyliszek",26],["Szlachetny bazyliszek",27],["Ziemny bazyliszek",26]]},{"lvl":28,"name":"Mulusy","maps":["1267","1285","3361"],"npcs":[["Bulu Mulu",29],["Dida Gula",28],["Fula Gula",25],["Furu Mulu",31],["Nuna Gula",26],["Zulu Gula",30],["Zulu Mulu",27]]},{"lvl":29,"name":"Demony","maps":["5736","5737","5738","5739","5740","5733","5734","5735"],"npcs":[["Dokuczliwy bies",29],["Kąśliwy demon",30],["Mały demon",28],["Nieznośny demon",29],["Paskudny demon",30],["Pomniejszy demon",28]]},{"lvl":32,"name":"Rozbójnicy","maps":["347","222","110","115","197","225","244","2530","2524","223","4","214","2531","2532","121","1390","196","1395","2317","194","195"],"npcs":[["Podejrzany zakapior",32],["Pospolity zbir",30],["Przebiegły łotr",34],["Rozbójniczka",35],["Stary rozbójnik",33],["Zapijaczony zbój",31],["Zły zbir",35]]},{"lvl":34,"name":"Gobliny","maps":["725","726","727","3149"],"npcs":[["Goblin traper",34],["Leśny goblin",34],["Mistrz fechtunku",36],["Pancerny goblin",35],["Władca krzewów",36],["Zły goblin",35]]},{"lvl":37,"name":"Puffy","maps":["1664","1665","1667","1668","1670","1688"],"npcs":[["Młody onyksowy skorpion",37],["Młody puff",36],["Onyksowy skorpion",38],["Puff",37]]},{"lvl":40,"name":"Dziki","maps":["214","361","4154","4155","4156","4157"],"npcs":[["Locha",40],["Odyniec",41],["Warchlak",39]]},{"lvl":40,"name":"Ghule","maps":["111","705","3402","112","702","703","704"],"npcs":[["Ghul cmentarny",41],["Ghul nocny",41],["Ghul słabeusz",40],["Ghul szaman",42],["Ghul wojownik",42]]},{"lvl":44,"name":"Wilcze plemię","maps":["155","156","2536","2537","2538","4546","4547","154"],"npcs":[["Oko Wilka",45],["Wilcza Więź",45],["Wilcze Prawo",44],["Wilczy Śpiew",43],["Zakrzywiony Pazur",44]]},{"lvl":45,"name":"Tolloki","maps":["5293","5948"],"npcs":[["Tollok Boger",44],["Tollok Surbit",45],["Tollok Tuarai",45],["Tollok Zibink",44]]},{"lvl":46,"name":"Zbiry","maps":["2308","2324","2350","2351","2352","4151"],"npcs":[["Niegodziwy drań",47],["Nikczemny łotr",46],["Podły szabrownik",45]]},{"lvl":47,"name":"Orkowie","maps":["116","118","119","122","127","130","131","2730","87","88","2733","124","126","117","125","129","120","123"],"npcs":[["Ork bashwooz",46],["Ork kuurgh",47],["Ork trarroll",48],["Ork wuakl",48],["Ork zhaghokk",47]]},{"lvl":50,"name":"Przesmyk","maps":["140","141","179","188","189","318","150","1730","1800","142"],"npcs":[["Czarny orzeł",54],["Grzechotnik",48],["Harpia",49],["Harpia złota",49],["Kobra",48],["Orzeł górski",53]]},{"lvl":51,"name":"Galarety","maps":["176","4262","4550","177","4582"],"npcs":[["Morska galareta",51],["Pąsowa galareta",51],["Przeźroczysta galareta",50],["Trująca galareta",50],["Wodna galareta",49],["Zgniła galareta",50]]},{"lvl":52,"name":"Pokątniki","maps":["6473","6474","6475"],"npcs":[["Pokątnik Karminowy",53],["Pokątnik Mglisty",52],["Pokątnik Ochnowy",52]]},{"lvl":54,"name":"Koboldy","maps":["815","816","2729","3869","814"],"npcs":[["Kobold",55],["Kobold nożownik",56],["Kobold łucznik",55]]},{"lvl":58,"name":"Żądłaki","maps":["138","5394","5395","5396","5397","5398","5399"],"npcs":[["Wściekłówka",59],["Żądłak",58],["Żądłak rogaty",58]]},{"lvl":61,"name":"Bazyliszki","maps":["199","200","201","202"],"npcs":[["Magiczny bazyliszek",61],["Purpurowy bazyliszek",62],["Srebrny bazyliszek",60]]},{"lvl":64,"name":"Gnolle","maps":["333","3300","3438","276","341","3440","1654","2646","3436","3437","3439","3441","3442","275"],"npcs":[["Gnoll mistrz ostrzy",63],["Gnoll łowca",65],["Gnoll strażnik",66],["Gnoll szaman",64],["Gnoll łucznik",63],["Gnoll wojownik",62]]},{"lvl":66,"name":"Mrówcza kolonia","maps":["6540","6541","6542","6543","6544","6545","6546","2520"],"npcs":[["Mrówka robotnica",66],["Mrówka z larwą",67],["Mrówka żołnierz",66]]},{"lvl":66,"name":"Rosomaki","maps":["8","2520"],"npcs":[["Rosomak",65],["Rosomak skalny",66]]},{"lvl":67,"name":"Olbrzymy","maps":["6535","6536","6537"],"npcs":[["Olbrzym miotający",67],["Olbrzym z maczugą",68],["Wiekowy olbrzym",69]]},{"lvl":70,"name":"Andarum i okolice","maps":["180","1387","1730","4548","140","150"],"npcs":[["Lazurowy tygrys",70],["Śnieżny niedźwiedź",71],["Śnieżny tygrys",71],["Śnieżny wilk",70],["Strażnik Andarum",70]]},{"lvl":71,"name":"Jaskiniowe tolloki","maps":["6628","6630","6631","6632","6633"],"npcs":[["Tollok Muchag",70],["Tollok Tarmec",72],["Tollok Zombe",71]]},{"lvl":72,"name":"Demilisze","maps":["6624","6625","6626","6627"],"npcs":[["Demilisz",72],["Wściekły demilisz",73]]},{"lvl":74,"name":"Mnisi","maps":["6611","6608","6609","6610","6616"],"npcs":[["Brat andaryjski",75],["Członek zakonu",74],["Pokutujący zakonnik",74],["Wojownik w habicie",75],["Zakapturzony mędrzec",73],["Zamyślony mnich",73]]},{"lvl":75,"name":"Biblioteka Andarum","maps":["6612"],"npcs":[["Duchowny w błękicie",76],["Klasztorny brodacz",75],["Strażnik cennych ksiąg",75],["Sługa ołtarza",76],["Władca pastorału",75],["Zakonnik wyższego kręgu",76]]},{"lvl":75,"name":"Wodniki","maps":["8530","8531","8532","8533","8534","8535"],"npcs":[["Topielec oczeretu",71]]},{"lvl":77,"name":"Magazynierzy","maps":["6613","6614","6615"],"npcs":[["Kawał chłopa",77],["Magazynier z halabardą",78],["Nadęty dryblas",77],["Świątynny kucharz",76],["Wytatuowany osiłek",78]]},{"lvl":80,"name":"Erem","maps":["6620","6621","6622","6623","6618","6619","6617"],"npcs":[["Duchowy rozpruwacz",79],["Kościste straszydło",80],["Mnich chybione zaklęcie",80],["Przerażający mnich",78],["Śmierć magazyniera",79]]},{"lvl":81,"name":"Minotaury","maps":["846","847","848","849"],"npcs":[["Minotaur",80],["Minotaur wojownik",83]]},{"lvl":83,"name":"Dławiciele","maps":["6628","6634","6635","6636"],"npcs":[["Dławiciel jaskiniowy",83],["Szary dławiciel",84]]},{"lvl":83,"name":"Miśki","maps":["1193","1204","1733","1734","1735","1736","3530"],"npcs":[["Lodowy włochacz",82],["Niedźwiedziołak",81],["Purpurowy włochacz",82]]},{"lvl":85,"name":"Wermonty","maps":["6629","282"],"npcs":[["Kornid jaskiniowy",84],["Kornid szkarłatny",85],["Wermont",84],["Wermont Pluskokwik",85],["Wermont Pokwas",85]]},{"lvl":86,"name":"Krasnoludy","maps":["6771","6772","6773","6774"],"npcs":[["Krasnoludzki górnik",85],["Krasnoludzki kowal",86],["Krasnoludzki strażnik",86],["Krasnoludzki wojownik",87]]},{"lvl":87,"name":"Darhouny","maps":["6775","6776"],"npcs":[["Jaskiniowa przeraza",88],["Przeklęty ogar",88],["Zdeformowany darhoun",87]]},{"lvl":89,"name":"Grexy","maps":[],"npcs":[["Grex",89],["Urgrap",90],["Volmat",90]]},{"lvl":91,"name":"Leszy","maps":["500","701","1137","1323","1324","1325","3890"],"npcs":[["Dziad borowy",92],["Leszy",91],["Opiekun lasu",91]]},{"lvl":92,"name":"Wieczornice i Południce","maps":["1137","1141","1146","1147","1148","1149","1150","1152","1153","3758","3759","3760","3761","3762","3763","3764","1151","1144","1145"],"npcs":[["Południca",92],["Wieczornica",93]]},{"lvl":94,"name":"Błotniste gady","maps":["246","339"],"npcs":[["Aligator",97],["Gawial",97],["Krokodyl",97],["Żółw drapieżny",96],["Żółw skórzasty",96]]},{"lvl":94,"name":"Gnomy","maps":["246","339","3758","3759","6777","6778","6779","6780","6781"],"npcs":[["Leśny gnom",94],["Młody gnom leśny",93],["Starszy gnom leśny",95]]},{"lvl":96,"name":"Ogniki","maps":["246","339"],"npcs":[["Błędne ogniki",96],["Zwodniczy płomień",97]]},{"lvl":98,"name":"Centaury","maps":["268","330","331","332","3765"],"npcs":[["Centaur obrońca",99],["Centaur łowca",97],["Centaur tropiciel",98],["Centaur łucznik",97],["Centaur wojownik",99],["Centaur zwiadowca",98]]},{"lvl":99,"name":"Małe gady i płazy","maps":["3766","332","330"],"npcs":[["Kameleon",100],["Młody kameleon",99],["Salamandra górska",100],["Salamandra nadrzewna",100],["Salamandra ognista",99],["Salamandra plamista",99],["Salamandra rdzawa",100],["Salamandra zielona",99]]},{"lvl":100,"name":"Bandyci","maps":["226","229","3766","6950","6952","1614","1631","6948","6949","4998","6951"],"npcs":[["Celne oko",101],["Cwany bandyta",100],["Łowca naiwniaków",101],["Rudy twardziel",101],["Sprytny bandzior",100]]},{"lvl":102,"name":"Mykonidy","maps":["590","591","592","593","594","595"],"npcs":[["Lodowy mykonid",104],["Magiczny mykonid",103],["Trujący mykonid",102]]},{"lvl":103,"name":"Molochy","maps":["6935","6936","6937","6938","6934"],"npcs":[["Istota wojny",104],["Mistrz ostrego cięcia",104],["Nieuzbrojony moloch",102],["Oprawca niewinnych",103],["Pożeracz niewiniątek",103]]},{"lvl":105,"name":"Dwugłowe olbrzymy","maps":["253","298","299","332"],"npcs":[["Barimnog",106],["Goliatog",105],["Zurlorog",105]]},{"lvl":106,"name":"Gady i płazy","maps":["6941","6939","6943","253","330","6940","338","361","600","730","10","12","19","36","37","84","121","128","1057","1108"],"npcs":[["Jadowita ropucha",105],["Krwiopijcza ropucha",107],["Kumak górski",107],["Niebieska żmija zygzakowata",106],["Olbrzymia jadowita ropucha",106],["Turkusowa ropucha",106],["Wąż falisty",106],["Wąż kopalniany",107],["Wąż prądowy",107],["Wąż wodny",106],["Wąż zbożowy",106],["Zielona żmija zygzakowata",105],["Żmija zygzakowata",16]]},{"lvl":107,"name":"Błotniste istoty","maps":[],"npcs":[["Błotniak",107]]},{"lvl":111,"name":"Alghule","maps":["7063","7064","7065","2865","7066"],"npcs":[["Alghul",111],["Alghulinia",111],["Alghul łucznik",112],["Alghul wojownik",112]]},{"lvl":111,"name":"Szkielety-koty","maps":["2864","2865","2887","2866","2869","2872","7062","1141","2871","1233"],"npcs":[["Groźna lwica",108],["Groźny lew",109],["Piaskowy tygrys",108],["Pustynny szakal",109],["Sępi Rozpruwacz",108],["Szkarłatny rycerz",110],["Szkielet rycerza",109],["Szkielet łucznika",111]]},{"lvl":114,"name":"Mumie","maps":["2868","2870","2866","2869"],"npcs":[["Cheperu",114],["Chodzące truchło",113],["Mumia wysokiego kapłana",114],["Piaskowe chuchro",114],["Scarabeaus Gir-tab",113],["Scarabeaus Nangar",112],["Scarabeaus Zihanitum",113],["Zabandażowany zwiadowca",115],["Zasuszony legionista",115]]},{"lvl":118,"name":"Kałamarnice","maps":["1739","7355","7356","7357","7353"],"npcs":[["Postrach plaż",118],["Skażona kałamarnica",118],["Srebrna ośmiornica",116],["Zguba marynarzy",117]]},{"lvl":121,"name":"Ingotia","maps":["1740","7358","7359","7360","7361","7362","7363","7364","7365","7366","7367","7368"],"npcs":[["Biały strzelec",121],["Obrońca wyspy",120],["Rogogłowy fechmistrz",119],["Rogogłowy kusznik",122],["Rogogłowy zawadiaka",121],["Rozjuszony minotaur",120]]},{"lvl":122,"name":"Kraby","maps":["1262","1741","7369","7370"],"npcs":[["Krab olbrzymi",123],["Krab wełnistoszczypcy",122]]},{"lvl":124,"name":"Caneum","maps":["1742","7371","7372","7373","7374","7375"],"npcs":[["Gliniana kukiełka",124],["Gliniany golem",125],["Iłowy potwór",125],["Marionetka demiurga",123],["Ziemisty narwaniec",124]]},{"lvl":127,"name":"Magradit","maps":["1743","7059"],"npcs":[["Feniks",128],["Palisandrowy skorpion",126],["Skorpion palącego jadu",126],["Skorpion świętego ognia",127],["Żelazowy skorpion",128],["Zjadliwy skorpion",127]]},{"lvl":127,"name":"Wraki","maps":["4362","1744","7071","7070"],"npcs":[["Potępiony łowca",129],["Przeklęty szkielet",129],["Szkielet pirata",128]]},{"lvl":129,"name":"Pająki","maps":["3468","3469","3470","3471","3472"],"npcs":[["Cichy zabójca",127],["Nocny skrytobójca",129],["Plujący truciciel",128]]},{"lvl":130,"name":"Piraci","maps":["1337","1338","1339","1340","1342","1345","1525","1526","1527","1528","3220","3409","1343","1341","1344"],"npcs":[["Bezduszna piratka",130],["Bezwzględny pirat",130],["Krnąbrny pirat",131],["Niemiłosierny pirat",131]]},{"lvl":133,"name":"Piaskowi niewolnicy","maps":["2871","2873"],"npcs":[["Apeliotes",134],["Boreasz",132],["Notos",132],["Zefir",133]]},{"lvl":134,"name":"Korredy","maps":["6954","6955","6953","6956"],"npcs":[["Korred czterołapy",135],["Korred wojownik",134],["Korred zbrojny",135]]},{"lvl":136,"name":"Impy","maps":["7455","7456","7457","7458","7459"],"npcs":[["Imp sługa",135],["Jaskiniowy zgrywus",136],["Piekielne licho",137],["Rogaty pomiot",136],["Wybraniec płomieni",137]]},{"lvl":137,"name":"Ognie","maps":["7460","7461","7462","7467"],"npcs":[["Piekielny żar",138],["Żywy ogień",137],["Żywy ogień trwogi",137]]},{"lvl":138,"name":"Ogniste golemy","maps":["7463","7464","7465","7466","7468","7469"],"npcs":[["Golem magmowa łapa",139],["Magmowy golem",138],["Wulkaniczny golem",138]]},{"lvl":140,"name":"Ważki","maps":["349","350","351","352"],"npcs":[["Pożognica księżycowa",140],["Pożognica rubinowa",141],["Pożognica tląca",141]]},{"lvl":143,"name":"Górale","maps":["350","351","7334","7335","7336","7337","352","7339","7340","7338"],"npcs":[["Dobra żona",144],["Góralski parobek",142],["Góralski rozbójnik",143],["Mistrz ciupagi",142],["Mlody juhas",143],["Łowczyni fretek",143],["Poganiacz owiec",144],["Stary dziad",141],["Strażnik piwa",144]]},{"lvl":147,"name":"Berserkerzy","maps":["1104","1106"],"npcs":[["Berserker Ahin",145],["Berserker Hlomer",147],["Berserker Kohta",146],["Berserker Murro",145],["Berserker Rokh",148],["Berserker Thruta",146]]},{"lvl":149,"name":"Duchy","maps":["7480","7481","7482","7483","7484"],"npcs":[["Duch arystokraty",149],["Potępiona markiza",149],["Przeklęta hrabina",148],["Prześwitujący baron",150],["Upiór w cylindrze",148],["Wystrojone widmo",150]]},{"lvl":151,"name":"Mechaniczne gobliny","maps":["7472","7473","7475","7476","7474","7471","7470"],"npcs":[["Boltor Grex",150],["Krogin Tektus",150],["Pixel Zorn",152],["Rotgot Megakus",151],["Tekmo Zinsus",152],["Tektor Vorn",152],["Ziblet Goons",151]]},{"lvl":152,"name":"Dusze","maps":["1202","1293"],"npcs":[["Duch nienawiści",153],["Duch próżności",152],["Duch zazdrości",153],["Dusza Potępionego Wojownika",152],["Dusza Wiecznego Romantyka",152],["Dusza Wiernego Strażnika",153]]},{"lvl":154,"name":"Wiedźmy","maps":["1202","1294","1297","1304","1315","1322","1302","1306","1298","1299","1300","1301","1305","1307","1308","1303"],"npcs":[["Latająca Wiedźma",155],["Opętana Wiedźma",155],["Potępiona Wiedźma",153],["Stara Wiedźma",154],["Upadła Wiedźma",155],["Wiedźma Ple-Ple",154]]},{"lvl":156,"name":"Czerwoni orkowie","maps":["355","356"],"npcs":[["Adept Orczej Magii",157],["Czerwonoskóry Wojownik",158],["Karminowy Watażka",156],["Obrońca Granic",156],["Ork Waleczny Młot",158],["Zakapturzony Ork Warlock",159]]},{"lvl":161,"name":"Dziki zagajnik","maps":["261","263","262","264","265"],"npcs":[["Gryf",162],["Hydra kamienna",161],["Hydra piaskowa",160],["Hydra rzeczna",161],["Hydra turkusowa",160],["Mantikora",161]]},{"lvl":163,"name":"Kazamaty","maps":["5871","5868","5869","5870","5872","5866","5867","5857","357"],"npcs":[["Królewski Praszaman",163],["Łowca Dusz",163],["Praorczy Herod",164],["Widmo Przeszłości",165],["Zjawa z Nawiedzonych Kazamat",164],["Żywe Kości Praorka",162]]},{"lvl":170,"name":"Komnaty","maps":["5863","5865","5859","5860"],"npcs":[["Czarny Gwardzista",171],["Nestor Praorczej Magii",170],["Niszczyciel Czaszek",169],["Obrońca Czarnej Perły",172],["Pradawny Halabardzista",172],["Pradawny Mistrz Miecza",166],["Pradawny Ork Warlock",167],["Szara Strzała",167],["Tropiciel Smoków",168],["Wysłużony Wiarus",173]]},{"lvl":174,"name":"Kryształowa grota","maps":["7342","7344"],"npcs":[["Ametystowy golem",174],["Cytrynowy golem",174],["Czerwonooka skała",173],["Lodowy golem",174],["Nimfa chłodu",174],["Nimfa mrozu",174],["Oszroniona skała",173],["Ożywiona zmarzlina",173],["Profos lodowej gwardii",175],["Rubinowy golem",174],["Szafirowy brodacz",175],["Tealowooka skała",173],["Turkusowy golem",174],["Zamarznięty strażnik królowej",175],["Żółtooka skała",173]]},{"lvl":178,"name":"Driady","maps":["5982","5984"],"npcs":[["Bijąca Wierzba",179],["Ciernista Strzała",178],["Fantom Kniei",180],["Leśny Wiatr",177],["Opiekunka Potoków",179],["Łowczyni Insektów",175],["Ożywiony Pień",178],["Patronka Żywicznej Magii",179],["Poranna Rosa",176],["Strażniczka Darów Lasu",177],["Władczyni Łąk",180]]},{"lvl":181,"name":"Ogry","maps":["7690","7691","7692","7693"],"npcs":[["Miażdżyciel Czaszek",181],["Ogr Łamacz Kości",180],["Ogr Ćwiartownik",182],["Okryst Czarny Rytuał",182],["Rozpruwacz Trzewi",181]]},{"lvl":184,"name":"Patrycjusze","maps":["6049","6050","6051","6052","6053"],"npcs":[["Nieumarły patrycjusz",183],["Opuszczony patrycjusz",184],["Osamotniona patrycjuszka",182],["Ożywione zwłoki",185]]},{"lvl":187,"name":"Zmutowane rośliny","maps":["344","1116"],"npcs":[["Bezkiełka łaknąca",187],["Mięsówka tyczkowa",186],["Pąkówka zębata",186],["Ślinówka kwaśna",186],["Szponówka drapieżna",187],["Szubieniczka wisząca",186],["Urwigłówka",185],["Wierciszka gniewna",187]]},{"lvl":189,"name":"Draki","maps":["4549","4548","2056","2063","5986"],"npcs":[["Drak białych nocy",189],["Drak szczypiącego mrozu",191],["Postrach Thuzalczyków",187],["Śnieżna Burza",189],["Strzała Północy",188],["Zahartowana wartowniczka",190]]},{"lvl":192,"name":"Mroczny las","maps":["7680","7682"],"npcs":[["Niewolnica pnączy",192],["Ofiara wymuszonej symbiozy",192],["Waleczny pień",193],["Więzień mrocznego lasu",193],["Zdrewniały ogar",191]]},{"lvl":196,"name":"Myświóry","maps":["7697","7698"],"npcs":[["Degustator szlamu",194],["Mieszkaniec kanałów",195],["Myświór Dziurka",195],["Myświór Pała",196],["Oczytany gryzoń",197],["Szczurzy gwardzista",197],["Zmutowane szczurzysko",194],["Zwinny Ogon",196]]},{"lvl":199,"name":"Hurysy","maps":["5938","5939","5940"],"npcs":[["Hurysa Lussien",198],["Hurysa Nikolja",200],["Hurysa Patisja",199],["Hurysa Rapsolieta",198]]},{"lvl":203,"name":"Heretycy","maps":["5943","5941","5942","5944","5945","5946","7694","7695","5947"],"npcs":[["Czciciel Demonów",204],["Heretyk Łowca Niewiast",204],["Heretyk Wirtuoz Tortur",204],["Krwawy Wyznawca",201],["Mistrz Rytuału",203],["Obrońca Sekty",205],["Opętany Heretyk",202],["Podziemny Wartownik",203],["Pogromca Myświórów",202],["Rozpruwacz Dziewic",201],["Wtajemniczony Heretyk",201]]},{"lvl":208,"name":"Furbole","maps":["3733","3735"],"npcs":[["Czarujący Furbol",206],["Furbol Tropiciel",207],["Myśliwy Furbol",208],["Szaman Furboli",207],["Wojowniczy Furbol",208],["Zwiadowca Furboli",209]]},{"lvl":212,"name":"Pająki","maps":["1138","3737"],"npcs":[["Bladolica Furiadetta",212],["Holostomon oreophilum",213],["Ischyropsalis alpinula",213],["Lasiodora parahybana",210],["Martwy rycerz Mietek",210],["Megaphobema mesomelas",210],["Meta menardi",213],["Nesticus eremita",212],["Nesticus morisii",211],["Porrhomma convexum",212],["Powykręcana Kugletta",211],["Rozpruta Tempera",213]]},{"lvl":216,"name":"Drowy","maps":["7857","7858"],"npcs":[["Kapłanka Rodu Milithor",215],["Mistrzyni lepkiej przędzy",215],["Pasterz ośmionogich",216],["Strażniczka podziemnego miasta",217],["Tępicielka elfiej krwi",216],["Znawca ciemności",214]]},{"lvl":219,"name":"Dridery","maps":["7863","7865"],"npcs":[["Drider",217],["Krwiożerczy drider",219],["Mroczny halabardzista",220],["Ośmionogi fechmistrz",218],["Pajęczy kat",218],["Pan ciemności",220],["Ponury sieciarz",220],["Rycerz podziemi",219]]},{"lvl":223,"name":"Anuraki","maps":["7825","7829"],"npcs":[["Anurak rechotliwy",224],["Arval grzebieniasty",223],["Boforan rogaty",223],["Jesiotrzyc wąsaty",221],["Pantherania rzeczna",222]]},{"lvl":227,"name":"Maddoki","maps":["7833","7839"],"npcs":[["Aligator rzeczny",225],["Kajman czarny",225],["Krokodyl różańcowy",225],["Niegościnny krokodyl",225],["Oślizgły wojownik",228],["Patron wodospadów",228],["Przyczajony maddok",226],["Silny aligator",225],["Smakosz świeżych ryb",229],["Strażnik wodorostów",227],["Zielonoskóry poławiacz",227]]},{"lvl":232,"name":"Zagrzybiony las","maps":["8168","8176"],"npcs":[["Grzybowa marionetka",233],["Koścista łania",230],["Niedźwiedź pełen zarodników",233],["Przejęte ciało żubra",234],["Rogaty ponurak",231],["Szkielet porośnięty grzybem",232],["Zainfekowane wilcze zwłoki",231]]},{"lvl":236,"name":"Elgary","maps":["8174","8183"],"npcs":[["Czarnowidzka",238],["Czcicielka księżyca",237],["Elgara",235],["Leśna boginka",237],["Lunarna łania",234],["Lunarny lisek",234],["Lunarny wilk",235],["Pani stukających kopyt",236],["Wrogo nastawiona elgara",236]]},{"lvl":239,"name":"Drzewce","maps":["3595","3596"],"npcs":[["Kamienny Starodrzew",238],["Kościodrzew",239],["Paszczodendron",239],["Rycerz Trzech Sęków",240]]},{"lvl":244,"name":"Bolity","maps":["1924","5653","5654","5655","5656","5657","5658","5659","5660","5661","5662"],"npcs":[["Cuetzpalli",245],["Jaskiniowa bolita",244],["Mutokli",242],["Nokturni",243],["Pancerna bolita",242],["Pesterni",241],["Szafirowa bolita",243]]},{"lvl":248,"name":"Niecka","maps":["1901","5667"],"npcs":[["Bojownik Słońca",246],["Cuextacatl",250],["Otomi",249],["Tlamanih",247],["Waleczny Jaguar",248]]},{"lvl":253,"name":"Maho","maps":["1926","5707"],"npcs":[["Kapłan Krwawej Ofiary",253],["Papalotl",251],["Teopixqui",254],["Yaotlakatl",252]]},{"lvl":258,"name":"Wiedźmowe potwory","maps":["4051","4270"],"npcs":[["Kapryśnica Gorejąca",257],["Obwisła Prukwa",256],["Odchodnica Cesarska",256],["Ścierwica Mięsówka",255],["Szpon podziemnej istoty",259],["Zadzierzgnięta Haniebnica",257],["Złośliwa Sekutnica",258]]},{"lvl":261,"name":"Potępione zamczysko","maps":["4048","4056"],"npcs":[["Dokuczliwa Bździągwa",260],["Kąsająca Grymaśnica",260],["Oblubienica Płomieni",262],["Posępna Czartolina",261],["Raszpla Ragana",259],["Rogata Rozkosznica",261]]},{"lvl":264,"name":"Tellary","maps":["8539","8542","8538","8541"],"npcs":[["Hipnotyzująca skała",263],["Kamienny kleszcz",266],["Kamienny osiłek",264],["Mineralny kret",262],["Mistrz koszmarnej liry",265],["Oślepiony faun",266],["Potępiony solista",263],["Skalna modliszka",262],["Skalny pupil",265],["Ślepa Strzała",265],["Twórczyni przeklętych tekstów",264],["Uzbrojony odszczepieniec",264],["Zaklinaczka fal dźwiękowych",263]]},{"lvl":268,"name":"Przestraszeni","maps":["8547","8548"],"npcs":[["Byt w konwulsjach",267],["Czarna fleja",269],["Mroczna poczwara",268],["Pan grawitacji",266],["Przestraszony",267],["Ptasie straszydło",269],["Świdrogłów",269],["Uosobienie gniewu",268]]},{"lvl":272,"name":"Katakumby","maps":["3034","3036","3037","3038","3039","3042","3043","3029","3030","3031","3032","3033","3035","3040","3041"],"npcs":[["Antyczny skrytobójca",272],["Imperialny gwardzista",274],["Imperialny oszczepnik",271],["Nekrolord Wernoradu",271],["Ożywiony asasyn",271],["Piaskowy włócznik",270],["Powiernik upadłego sztandaru",274],["Przebudzone truchło",270],["Starożytny legionista",272],["Strażnik katakumb",271],["Szkielet imperialnego piechura",273],["Truchło arystokraty",270],["Wernoradzka jednostka specjalna",273],["Wernoradzki mistyk",273],["Zasuszony szkielet bojowy",272],["Żołnierz imperialny",274]]},{"lvl":278,"name":"Pustynia","maps":["3326","3328","3323","3335"],"npcs":[["Czciciel Charkhaam",279],["Piłowiec",277],["Sęp",275],["Shaiharrudzki mutant",276],["Smokoszczęki",278],["Sługa piasków",279],["Tancerz Shaiharrud",278],["Zaklinacz sępów",276]]},{"lvl":282,"name":"Wodniki","maps":["8530","8531","8532","8533","8534","8535"],"npcs":[["Dziwożona",281],["Mamuna",283],["Ofiara moczarów",281],["Oślizgły bebok",284],["Topielica",280],["Wodnik",283],["Wyziębły topielec",282]]},{"lvl":286,"name":"Mroczne driady","maps":["5987","5989","5988"],"npcs":[["Bezwzględna Echeveria",284],["Bluszczowa Wojowniczka",285],["Chamedora Pani Drzew",286],["Driada Haworsja",286],["Hoya Carnosa",285],["Mroczna Difenbachia",284],["Sansevieria Strażniczka Kniei",287]]}];

  const toArray = value => !value ? [] : Array.isArray(value) ? value : value instanceof Map ? Array.from(value.values()) : typeof value === 'object' ? Object.values(value) : [];
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
  const keyNorm = value => norm(value).replace(/[^a-z0-9]+/g,'');
  const numeric = value => value === '' || value == null ? NaN : Number(value);
  const goodId = value => /^\d+$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const readJSON = (key,fallback) => {try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch {return fallback;}};
  const saveJSON = (key,value) => {try {localStorage.setItem(key,JSON.stringify(value));return true;} catch (e) {console.warn('[MF61] localStorage:',e);return false;}};
  const namesToIds = new Map();
  for (const [id,name] of Object.entries(MAP_NAMES)) {
    const nk=norm(name);
    if (!namesToIds.has(nk)) namesToIds.set(nk,[]);
    namesToIds.get(nk).push(String(id));
  }
  function uniqueIdForName(name) {
    const ids=namesToIds.get(norm(name)) || [];
    return ids.length===1 ? ids[0] : null;
  }
  function getEngineSafe() {
    try {return typeof getEngine==='function' ? getEngine() : ROOT.Engine ?? null;} catch {return null;}
  }
  function currentMap(g) {
    const id=g?.map?.d?.id;
    return goodId(id) && Number.isSafeInteger(Number(id)) ? String(id) : null;
  }
  function position(g) {
    const x=numeric(g?.hero?.rx ?? g?.hero?.d?.x);
    const y=numeric(g?.hero?.ry ?? g?.hero?.d?.y);
    return Number.isFinite(x)&&Number.isFinite(y) ? {x,y} : null;
  }
  function charLevel(g) {
    const n=numeric(g?.hero?.d?.lvl ?? g?.hero?.d?.level);
    return Number.isFinite(n) ? n : 0;
  }
  function getGates(g) {
    let raw;
    try {raw=g?.map?.gateways?.getList?.();} catch{}
    return toArray(raw);
  }
  function gateLabel(gw) {
    return String(Array.isArray(gw?.tip) ? gw.tip[0] : gw?.tip ?? gw?.d?.tip ?? gw?.d?.name ?? gw?.d?.destination ?? '')
       .split(/<br\s*\/?\s*>|\[br\]/i)[0].replace(/<[^>]*>/g,'').trim();
  }
  function gateTarget(gw) {
    const d=gw?.d || {};
    for (const value of [d.targetMapId,d.targetId,d.targetMap,d.toMapId,d.toMap,d.destMap,d.destinationMapId,gw?.targetMapId,gw?.to,gw?.d?.mapId,gw?.d?.map]) {
      if (goodId(value)) return String(value);
    }
    return uniqueIdForName(gateLabel(gw));
  }
  function gateCoords(gw) {
    const x=numeric(gw?.d?.x ?? gw?.x ?? gw?.rx),y=numeric(gw?.d?.y ?? gw?.y ?? gw?.ry);
    return Number.isFinite(x)&&Number.isFinite(y) && x>=0 && y>=0 ? {x,y}:null;
  }
  function gateAllowed(gw,g) {
    if (gw?.available === false) return false;
    const tip=String(Array.isArray(gw?.tip)?gw.tip[0]:gw?.tip ?? '');
    const level=tip.match(/(?:od|minimum|min\.?|wymagany)\s*(\d+)\s*(?:poziomu|lvl)?/i);
    return !level || charLevel(g)>=Number(level[1]);
  }

  let atlas=readJSON(STORE_ATLAS,{version:1,maps:{}});
  if (!atlas || typeof atlas!=='object' || !atlas.maps || typeof atlas.maps!=='object' || Array.isArray(atlas.maps)) atlas={version:1,maps:{}};
  // Zapis atlasu z opóźnieniem: zamiast serializacji kilkuset map co 700 ms.
  let atlasDirty=false,atlasTimer=null,graphRevision=0;
  const pathsCache=new Map();
  function markAtlasDirty(){
    atlasDirty=true;graphRevision++;pathsCache.clear();
    if(atlasTimer===null)atlasTimer=setTimeout(flushAtlas,1600);
  }
  function flushAtlas(){
    if(atlasTimer!==null){clearTimeout(atlasTimer);atlasTimer=null;}
    if(!atlasDirty)return;
    if(saveJSON(STORE_ATLAS,atlas)!==false)atlasDirty=false;
  }
  function graphChanged(){graphRevision++;pathsCache.clear();}
  function ensureMap(id,name) {
    id=String(id);
    if (!goodId(id)) return null;
    if(!Object.hasOwn(atlas.maps,id)){atlas.maps[id]={name: MAP_NAMES[id] || name || '',exits:[]};markAtlasDirty();}
    const m=atlas.maps[id];
    m.name=m.name || name || MAP_NAMES[id] || '';
    if (!Array.isArray(m.exits)){m.exits=[];markAtlasDirty();}
    return m;
  }
  function addExit(from,to,x,y,meta={}) {
    if (!goodId(from)||!goodId(to)||String(from)===String(to)) return false;
    x=numeric(x);y=numeric(y);
    if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0) return false;
    const m=ensureMap(from);
    const prev=m.exits.find(e => e.to===String(to) && e.x===x && e.y===y);
    if (prev) {
      if (meta.confirmed && !prev.confirmed){prev.confirmed=true;markAtlasDirty();}
      return false;
    }
    m.exits.push({to:String(to),x,y,name:String(meta.name || MAP_NAMES[to] || ''),confirmed:!!meta.confirmed,source:String(meta.source || 'atlas')});
    ensureMap(to);markAtlasDirty();
    return true;
  }
  const rawExits=(m) => {
    const entries=[];
    for (const field of ['gateways','exits','edges']) {
      const value=m?.[field];
      for (const item of toArray(value)) {
        if (item && typeof item==='object') entries.push(item);
      }
    }
    return entries;
  };
  function importMapSet(maps,source) {
    if (!maps || typeof maps!=='object') return 0;
    let count=0;
    const list=Array.isArray(maps)?maps.map(m=>[String(m.id??m.mapId),m]):Object.entries(maps);
    for (const [id,m] of list) {
      if (!goodId(id)||!m || typeof m!=='object')continue;
      ensureMap(id,m.name || m.mapName);
      for (const e of rawExits(m)) {
        const target=e.targetMapId ?? e.targetId ?? e.toMapId ?? e.to ?? e.target ?? e.destinationMapId ?? e.nextMapId;
        const dest=goodId(target)?String(target):uniqueIdForName(e.name||e.label);
        if (!dest)continue;
        const x=e.representativeX ?? e.gwX ?? e.gatewayX ?? e.x ?? e.gw?.[0] ?? e.position?.x;
        const y=e.representativeY ?? e.gwY ?? e.gatewayY ?? e.y ?? e.gw?.[1] ?? e.position?.y;
        if(addExit(id,dest,x,y,{source,name:e.name,confirmed:e.confirmed === true}))count++;
      }
    }
    return count;
  }
  function importOldAtlases() {
    let count=0;
    for (const key of ['MargonemMultiFarm_MapDB_v1','MargonemMapGraph_v1','MargonemMapGraph','MargonomWorldMap_Global']) {
      const d=readJSON(key,{});
      count+=importMapSet(d.maps,key);
    }
    const cart=readJSON('MF_Cartographer_v1',{});
    if (cart.maps) {
      for (const [id,m] of Object.entries(cart.maps)) {
        ensureMap(id,m?.name);
        for (const e of toArray(m?.gateways)) {
          const to=goodId(e?.to)?String(e.to):uniqueIdForName(e?.name);
          if(to && addExit(id,to,e?.x,e?.y,{source:'cartographer',name:e?.name})) count++;
        }
      }
    }
    for (const edge of toArray(cart.edges)) {
      if(edge?.confirmed===true && addExit(edge.from,edge.to,edge.x,edge.y,{source:'cartographer-confirmed',confirmed:true}))count++;
    }
    try {
      for (const holder of [ROOT.mapGraph, ROOT.MapGraph, ROOT.mapgraph]) {
        count+=importMapSet(holder?.data?.maps || holder?.maps,'mapgraph-live');
      }
    } catch{}
    return count;
  }
  const imported=importOldAtlases();
  // Bramki potwierdzone przez użytkownika na mapie 500.
  for(const [name,x,y] of [
    ['Las Dziwów',0,26],['Las Dziwów',0,27],['Las Dziwów',0,28],
    ['Sosnowe Odludzie',25,95],['Sosnowe Odludzie',26,95],['Sosnowe Odludzie',27,95],
    ['Jezioro Ważek',44,0],['Jezioro Ważek',45,0],
    ['Grota Samotnych Dusz p.3 - sala wyjściowa',57,19],
    ['Zapomniana Ścieżyna',63,69],['Zapomniana Ścieżyna',63,70]
  ]) {const id=uniqueIdForName(name);if(id)addExit('500',id,x,y,{source:'user-confirmed',confirmed:true,name});}
  addExit('1141','1137',63,20,{source:'user-confirmed',confirmed:true});
  addExit('344','1116',0,30,{source:'user-confirmed',confirmed:true});
  flushAtlas();

  const explore=readJSON(STORE_EXPLORE,{tried:{},transitions:0});
  if(!explore.tried||typeof explore.tried!=='object')explore.tried={};
  // Dawne trwałe blokady nie mogą unieruchamiać tras na zawsze.
  for(const [key,value] of Object.entries(explore.tried)){
    if(value==='blocked') delete explore.tried[key];
  }
  const routeKey=(from,to)=>String(from)+':'+String(to);
  function edgeBlocked(from,to){
    const value=explore.tried[routeKey(from,to)];
    if(!value || typeof value!=='object' || value.state!=='blocked')return false;
    if(value.until>Date.now())return true;
    delete explore.tried[routeKey(from,to)];graphChanged();return false;
  }
  function blockEdge(from,to,reason,ttlMs=90000){
    const key=routeKey(from,to),previous=explore.tried[key];
    const failures=Math.min(8,(Number(previous?.failures)||0)+1);
    explore.tried[key]={state:'blocked',reason:String(reason),failures,
      until:Date.now()+Math.min(600000,Math.max(30000,ttlMs)*Math.min(failures,4))};
    saveJSON(STORE_EXPLORE,explore);graphChanged();
  }
  function resetBlockedRoutes(){
    let removed=0;
    for(const [key,value] of Object.entries(explore.tried))if(value?.state==='blocked'||value==='blocked'){
      delete explore.tried[key];removed++;
    }
    saveJSON(STORE_EXPLORE,explore);graphChanged();
    status('Odblokowano '+removed+' tymczasowych przejść.','ATLAS');return removed;
  }
  // Blokada zakupu teleportów jest osobna dla każdej postaci i przeżywa odświeżenie strony.
  // true = wykonano już jedno uzupełnienie przy zapasie <10; ponownie uzbroi się dopiero po osiągnięciu >=10.
  const savedScrollLocks=readJSON(STORE_SCROLL_LOCKS,{});
  const scrollPurchaseLocks=savedScrollLocks && typeof savedScrollLocks==='object' && !Array.isArray(savedScrollLocks)
    ?savedScrollLocks:{};
  let activeScrollCharacter=null;
  const saved=readJSON(STORE_CONFIG,{selected:46,running:false});
  const userOptions={autoSupply:saved.autoSupply!==false,autoExplore:saved.autoExplore!==false,autoFight:saved.autoFight!==false};
  const state={
    running:false,selected:Number.isInteger(saved.selected)&&EXP[saved.selected]?saved.selected:47,
    phase:'STOP', message:'Gotowy', lastMap:null,mapEnteredAt:Date.now(),
    noMobSince:Date.now(), lastAction:0,lastGateMove:0,lastGateRequest:0,
    lastProgress:Date.now(),lastPos:null, pendingGate:null,
    noRouteNoticeAt:0, lastStatusAt:0, blacklisted:new Map(),
    lastTargetId:null,lastTargetPos:null,lastTargetSince:0,navDestination:null,
    lastAttackAt:0,lastAttackTargetId:null,lastAutoFightAt:0,expoVisits:{},lastSeenMatches:0,shopPurchaseCount:0,supplyReturnExpo:null, supplyPhase:'idle',supplyReason:'',supplyReturnMap:null,supplyLastAttempt:0,supplyScrollGoal:0,supplyPotionGoal:0,supplyScrollPurchased:false,shopOrdinaryIds:[],shopPending:null,shopStep:'open',shopOpenAt:0,shopTalkAt:0,shopTalkAttempts:0,shopReplyAt:0,shopError:'',teleportAt:0,exploreSince:0,exploreSteps:0,lastSupplyScrollCount:null,consecutiveTickErrors:0,lastError:null,noRouteSince:0,atlasCachedAt:0
  };
  const chosen=()=>EXP[state.selected];
  const expoNpcIndex=new WeakMap();
  function npcIndex(expo){
    let index=expoNpcIndex.get(expo);
    if(!index){
      index=new Map();
      for(const [name,level] of expo.npcs||[]){
        const key=keyNorm(name),levels=index.get(key)||[];levels.push(Number(level));index.set(key,levels);
      }
      expoNpcIndex.set(expo,index);
    }
    return index;
  }
  let tickSerial=0,charactersCached=null,inventoryCached=null;

  const expoMaps=()=>new Set(chosen().maps.map(String));
  let loop=null,lastUI='',panel=null,statusEl=null,logEl=null,selectEl=null;
  function status(message,phase=state.phase) {
    state.message=message;state.phase=phase;
    const key=phase+'|'+message;
    if (key!==lastUI) {
      lastUI=key;console.info('[MF61]',phase,message);
      if(logEl) {const row=document.createElement('div'); row.textContent=new Date().toLocaleTimeString()+' '+message;logEl.prepend(row); while(logEl.children.length>12)logEl.lastChild.remove();}
    }
    if(statusEl) statusEl.textContent=phase+' · '+message;
  }
  function scanLive(g,id) {
    if(!id)return;
    const m=ensureMap(id,g?.map?.d?.name || '');
    const before=m.exits.length;
    for(const gw of getGates(g)) {
      const to=gateTarget(gw), xy=gateCoords(gw);
      if(to && xy)addExit(id,to,xy.x,xy.y,{source:'live',name:gateLabel(gw)});
    }
    if(m.exits.length!==before)markAtlasDirty();
  }
  function allPaths(from,blockedFirst=new Set()) {
    const start=String(from),now=Date.now();
    if(!goodId(start))return new Map();
    const cache=blockedFirst.size===0?pathsCache.get(start):null;
    if(cache && cache.revision===graphRevision && now-cache.at<1800)return cache.paths;
    const paths=new Map([[start,[start]]]),queue=[start];
    for(let i=0;i<queue.length;i++){
      const at=queue[i];
      // Trasy zweryfikowane mają pierwszeństwo w obrębie tej samej odległości.
      const edges=(atlas.maps[at]?.exits||[]).slice().sort((a,b)=>Number(!!b.confirmed)-Number(!!a.confirmed));
      for(const edge of edges){
        const to=String(edge.to);
        if(at===start && blockedFirst.has(routeKey(at,to)))continue;
        if(!goodId(to)||edgeBlocked(at,to)||!Number.isFinite(Number(edge.x))||!Number.isFinite(Number(edge.y)))continue;
        if(!paths.has(to)){
          paths.set(to,[...paths.get(at),to]);queue.push(to);
        }
      }
    }
    if(blockedFirst.size===0){
      if(pathsCache.size>=12)pathsCache.delete(pathsCache.keys().next().value);
      pathsCache.set(start,{paths,at:now,revision:graphRevision});
    }
    return paths;
  }
  function findNearest(from,targets) {
    const paths=allPaths(from);
    return targets.filter(t=>paths.has(String(t)))
      .map(t=>({id:String(t),path:paths.get(String(t))}))
      .sort((a,b)=>a.path.length-b.path.length)[0] || null;
  }
  function getCharacters(g) {
    if(charactersCached?.serial===tickSerial && charactersCached.engine===g)return charactersCached.data;
    const byId=new Map();
    for(const source of [()=>g?.npcs?.check?.(),()=>g?.npcs?.getList?.(),()=>g?.map?.npcs?.getList?.(),()=>g?.npcs?.getDrawableList?.()]) {
      let value;try{value=source();}catch{continue;}
      for(const n of toArray(value)) {
        const d=n?.d ?? n;
        if(!d || d.id==null)continue;
        const id=String(d.id);
        const candidate={id, d,source:n};
        const score=a=>Number(numeric(a.d.lvl ?? a.d.level)>0)*10+Number(!!(a.d.nick??a.d.name))*2+Number(Number.isFinite(numeric(a.d.x)))*2;
        if(!byId.has(id) || score(candidate)>score(byId.get(id)))byId.set(id,candidate);
      }
    }
    const result=[...byId.values()];charactersCached={serial:tickSerial,engine:g,data:result};return result;
  }
  function matchesNPC(d,expo) {
    const lvl=numeric(d?.lvl ?? d?.level), name=keyNorm(d?.nick??d?.name);
    if(!Number.isFinite(lvl)||lvl<=0||!name)return false;
    const type=numeric(d?.type);
    if(type===4||type===5)return false;
    if(d.dead===true||d.isDead===true)return false;
    if(numeric(d.elite)>0||numeric(d.elite2)>0||numeric(d.heroic)>0)return false;
    if(numeric(d.wtype)>9 || numeric(d.rank)>0)return false;
    return (npcIndex(expo).get(name)||[]).some(expectedLvl=>Math.abs(lvl-expectedLvl)<=3);
  }
  function matchingMobs(g,expo) {
    const pos=position(g);
    if(!pos)return [];
    const now=Date.now();
    for(const [id,expiry] of state.blacklisted) if(expiry<now)state.blacklisted.delete(id);
    return getCharacters(g).filter(c=>matchesNPC(c.d,expo) &&
      Number.isFinite(numeric(c.d.x)) && Number.isFinite(numeric(c.d.y)) && !state.blacklisted.has(c.id))
      .map(c=>({...c,dist:Math.abs(numeric(c.d.x)-pos.x)+Math.abs(numeric(c.d.y)-pos.y)}))
      .sort((a,b)=>a.dist-b.dist);
  }
  function inBattle(g) {
    try {
      if(g?.battle?.d?.inBattle===true || g?.battle?.d?.battle===true)return true;
      if(g?.battle?.isActive?.()===true)return true;
      if(g?.battle?.isInBattle?.()===true)return true;
      if(g?.battle?.isFight===true)return true;
    } catch{}
    return false;
  }
  function handleBattle(g) {
    if(!userOptions.autoFight){status('Trwa walka — autowalka wyłączona w ustawieniach.','WALKA');return;}
    if(Date.now()-state.lastAutoFightAt>650) {
      state.lastAutoFightAt=Date.now();
      try{g.battle?.autoFight?.();}catch(e){status('Problem z auto-walką: '+String(e),'WALKA');}
    }
    status('Trwa walka, oczekuję na jej zakończenie.','WALKA');
  }
  function navigate(g,current,target) {
    if(current===String(target))return true;
    const paths=allPaths(current);
    const path=paths.get(String(target));
    if(!path||path.length<2) {
      if(!state.noRouteSince)state.noRouteSince=Date.now();
      if(Date.now()-state.noRouteSince>150000){failStop('Brak trasy do '+target+' przez ponad 2,5 min.');return false;}
      if(Date.now()-state.noRouteNoticeAt>10000) {
        state.noRouteNoticeAt=Date.now();
        status('Brak pełnej trasy '+current+' → '+target+' w atlasie. Nie wybieram losowej bramki.','BRAK TRASY');
      }
      return false;
    }
    state.noRouteSince=0;
    const next=path[1],exits=(atlas.maps[current]?.exits||[]).filter(e=>e.to===next);
    const gateways=getGates(g);
    const live=gateways.filter(gw=>gateTarget(gw)===next && gateAllowed(gw,g) && gateCoords(gw));
    const pos=position(g);
    if(!pos)return false;
    let gate=null;
    if(live.length) {
      const gw=live.sort((a,b)=>{
        const pa=gateCoords(a),pb=gateCoords(b);
        return Math.abs(pa.x-pos.x)+Math.abs(pa.y-pos.y)-Math.abs(pb.x-pos.x)-Math.abs(pb.y-pos.y);
      })[0];
      gate={...gateCoords(gw),to:next,from:current,live:true};
    } else if (!gateways.some(gw=>gateTarget(gw)===next && !gateAllowed(gw,g))) {
      const e=exits.sort((a,b)=>Math.abs(a.x-pos.x)+Math.abs(a.y-pos.y)-Math.abs(b.x-pos.x)-Math.abs(b.y-pos.y))[0];
      if(e)gate={x:e.x,y:e.y,to:next,from:current,live:false};
    }
    if(!gate) {blockEdge(current,next,'unavailable',90000);state.navDestination=null;status('Bramka '+current+' → '+next+' jest niedostępna (tymczasowo); szukam innej trasy.','BRAK BRAMKI');return false;}
    const key=current+':'+next+':'+gate.x+':'+gate.y;
    const now=Date.now();
    if(state.pendingGate?.key!==key) {
      state.pendingGate={...gate,key,since:now};state.lastProgress=now;state.lastPos=null;
    }
    const pkey=pos.x+','+pos.y;
    if(state.lastPos!==pkey){state.lastPos=pkey;state.lastProgress=now;}
    if(now-state.lastProgress>22000 || now-state.pendingGate.since>75000) {
      blockEdge(current,next,'stuck',150000);
      status('Przejście '+current+' → '+next+' utknęło; pomijam niedostępną bramkę.','UTKNĄŁ');
      state.pendingGate=null;state.navDestination=null;return false;
    }
    if(now-state.lastGateMove<600)return false;
    state.lastGateMove=now;
    try {
      if(Math.abs(pos.x-gate.x)+Math.abs(pos.y-gate.y)<=1 && typeof g.hero.getTroughGateway==='function') {
        if(now-state.lastGateRequest>1800){state.lastGateRequest=now;state.pendingGate.attemptedAt=now;g.hero.getTroughGateway();}
        status('Przechodzę: '+current+' → '+next+' (cel '+target+').','PRZEJŚCIE');
      } else if(typeof g.hero.autoGoTo==='function') {
        g.hero.autoGoTo({x:gate.x,y:gate.y});
        status('Idę do bramki: '+current+' → '+next+' @ '+gate.x+','+gate.y+'.','PODRÓŻ');
      } else {failStop('Brak metody autoGoTo w silniku gry.');}
    } catch(e){status('Błąd przejścia: '+String(e?.message||e),'BŁĄD');}
    return false;
  }
  function saveConfig(){saveJSON(STORE_CONFIG,{selected:state.selected,running:state.running,...userOptions});}
  function resetForMap(id) {
    state.lastMap=id;state.mapEnteredAt=Date.now();state.noMobSince=Date.now();state.noRouteSince=0;
    state.lastTargetId=null;state.lastTargetPos=null;state.lastTargetSince=0;
    state.pendingGate=null;state.lastPos=null;state.lastProgress=Date.now();
    state.navDestination=null;state.lastAction=0;state.lastAttackTargetId=null;state.blacklisted.clear();
  }
  function farm(g,id,expo) {
    const now=Date.now();
    const mobs=matchingMobs(g,expo);
    if(mobs.length) {
      state.noMobSince=now;state.navDestination=null;
      const mob=mobs[0],pos=position(g);
      const targetPos=mob.d.x+','+mob.d.y;
      if(state.lastTargetId!==mob.id || state.lastTargetPos!==targetPos) {
        state.lastTargetId=mob.id;state.lastTargetPos=targetPos;state.lastTargetSince=now;state.lastPos=null;state.lastProgress=now;
      }
      const heroPos=pos.x+','+pos.y;
      if(state.lastPos!==heroPos) {state.lastPos=heroPos;state.lastProgress=now;}
      if(now-state.lastProgress>17000 && mob.dist>1) {
        state.blacklisted.set(mob.id,now+45000);state.lastTargetId=null;
        status('NPC '+(mob.d.nick||mob.d.name)+' jest niedostępny; wybieram inny cel.','OMIJAM');return;
      }
      if(mob.dist>1) {
        if(now-state.lastAction>1100) {
          state.lastAction=now;
          try {g.hero.autoGoTo({x:Number(mob.d.x),y:Number(mob.d.y)});}
          catch(e){status('Nie można podejść do NPC: '+String(e),'BŁĄD');return;}
        }
        status('Podchodzę do: '+(mob.d.nick||mob.d.name)+' ('+mob.d.lvl+' lvl).','EXP');
      } else if(now-state.lastAction>1150) {
        if(state.lastAttackTargetId===mob.id && now-state.lastAttackAt<3500) {
          status('Oczekuję na rozpoczęcie walki z '+(mob.d.nick||mob.d.name)+'.','EXP');
          return;
        }
        state.lastAction=now;
        if(typeof g.hero.heroAtackRequest!=='function') {
          status('Silnik nie udostępnia heroAtackRequest; atak niemożliwy.','BŁĄD');
          failStop('Silnik nie udostępnia heroAtackRequest; atak niemożliwy.');return;
        }
        try {
          g.hero.heroAtackRequest(mob.d.id,false);
          if(userOptions.autoFight)try{g.battle?.autoFight?.();}catch{}
          state.lastAttackAt=now;state.lastAttackTargetId=mob.id;
          status('Próba ataku: '+(mob.d.nick||mob.d.name)+' ('+mob.d.lvl+' lvl).','EXP');
        } catch(e){status('Błąd ataku: '+String(e?.message||e),'BŁĄD');}
      }
      return;
    }
    // NPC ładują się z opóźnieniem po przejściu na mapę.
    if(now-state.mapEnteredAt<2200){status('Czekam na wczytanie potworów.','EXP');return;}
    if(now-state.noMobSince<5000){status('Brak przypisanych NPC — czekam na respawn.','EXP');return;}
    // Rotate through the entire expowisko, not only the nearest map repeatedly.
    const other=expo.maps.filter(map=>map!==id);
    const paths=allPaths(id);
    const reachable=other.filter(map=>paths.has(String(map)));
    const visits=state.expoVisits||(state.expoVisits={});
    const candidates=reachable.sort((a,b)=>(visits[a]||0)-(visits[b]||0)||paths.get(String(a)).length-paths.get(String(b)).length);
    const dest=candidates.length?{id:String(candidates[0]),path:paths.get(String(candidates[0]))}:null;
    if(!dest){status('Brak mobów i znanej trasy na kolejną mapę tego expowiska. Czekam na respawn.','BRAK TRASY');state.noMobSince=now;return;}
    state.navDestination=dest.id;
    state.expoVisits[dest.id]=(state.expoVisits[dest.id]||0)+1;
    state.noMobSince=now;
    status('Mapa pusta; zmieniam na '+(MAP_NAMES[dest.id]||dest.id)+'.','PODRÓŻ');
    navigate(g,id,dest.id);
  }
  // Systematic map exploration instead of loops when no world-wide graph is available.
  // It learns observed transitions, never invents a gateway target, and avoids repeating failed exits.
  function markTransition(from,to){
    if(state.pendingGate?.from===from && state.pendingGate.to===to){
      const key=routeKey(from,to);explore.tried[key]='visited';explore.transitions++;
      saveJSON(STORE_EXPLORE,explore);
    }
  }
  function exploreNavigate(g,id,targets,phase){
    const now=Date.now();
    if(!userOptions.autoExplore)return false;
    if(state.exploreSteps>150){failStop('Osiągnięto limit 150 przejść odkrywania bez odnalezienia celu.');return true;}
    // Prefer a route to a map where another, as yet untried, gateway exists.
    const paths=allPaths(id);
    const frontiers=[];
    for(const [mid,path] of paths){
      const m=atlas.maps[mid];if(!m)continue;
      const liveAvailable=mid!==id?null:new Set(getGates(g).filter(gw=>gateAllowed(gw,g)&&gateCoords(gw)).map(gateTarget).filter(Boolean));
      const unknown=(m.exits||[]).filter(e=>!edgeBlocked(mid,e.to) && explore.tried[routeKey(mid,e.to)]!=='visited' && e.to!==id && (liveAvailable===null || liveAvailable.has(e.to)));
      if(unknown.length)frontiers.push({mid,path,unknown});
    }
    frontiers.sort((a,b)=>a.path.length-b.path.length);
    let next;
    if(frontiers.length){
      const f=frontiers[0];if(f.mid!==id){navigate(g,id,f.mid);status('Odkrywanie tras: idę na '+(MAP_NAMES[f.mid]||f.mid)+'.',phase);return true;}
      next=f.unknown.find(e=>!edgeBlocked(id,e.to) && explore.tried[routeKey(id,e.to)]!=='visited');
    }
    if(!next){
      // A live gate can still be seen before the static atlas has been saved.
      const candidates=getGates(g).filter(x=>gateAllowed(x,g)).map(x=>({to:gateTarget(x),xy:gateCoords(x)})).filter(x=>x.to&&x.xy&&!edgeBlocked(id,x.to)&&explore.tried[routeKey(id,x.to)]!=='visited');
      if(candidates.length){const e=candidates[0];next={to:e.to,...e.xy};}
    }
    if(!next)return false;
    if(state.pendingGate?.from===id && state.pendingGate?.to===next.to && now-state.pendingGate.since>78000){
      blockEdge(id,next.to,'explore-timeout',150000);
      state.pendingGate=null;status('Zablokowana bramka '+id+' → '+next.to+'; wybieram inną.','ODKRYWANIE');return true;
    }
    if(state.pendingGate?.from!==id || state.pendingGate?.to!==next.to){state.exploreSteps++;}
    navigate(g,id,next.to);
    status('Odkrywam połączenie '+id+' → '+next.to+' ('+phase+').','ODKRYWANIE');
    return true;
  }
  // Supply: rules selected by player. No auto-heal or HP consumption.
  const SUPPLY={tuniaMap:'353',approachMap:'344',potionThreshold:5,potionTarget:150,
    scrollThreshold:10,scrollPack:5,scrollName:'Zwój teleportacji na Kwieciste Przejście',
    merchantId:16366,merchantX:7,merchantY:10,merchantNpcY:9,potionName:'Mikstura początkującego alchemika',potionPack:5};
  function scrollCharacterKey(g){
    // ID i nazwa przypisują blokadę do właściwej postaci, nie do wszystkich postaci na serwerze.
    const value=g?.hero?.d?.id ?? g?.hero?.id ?? g?.hero?.d?.nick ?? g?.hero?.d?.name;
    return value==null || String(value).trim()==='' ? null : String(value);
  }
  function setScrollPurchaseLock(g,locked){
    const key=scrollCharacterKey(g);
    state.supplyScrollPurchased=!!locked;
    if(!key)return false;
    activeScrollCharacter=key;
    if(scrollPurchaseLocks[key]!==!!locked){
      scrollPurchaseLocks[key]=!!locked;
      saveJSON(STORE_SCROLL_LOCKS,scrollPurchaseLocks);
    }
    return true;
  }
  function syncScrollPurchaseLock(g,amount){
    const key=scrollCharacterKey(g);
    if(!key)return false; // Bez identyfikacji postaci nie ryzykuj ponownego zakupu.
    if(activeScrollCharacter!==key){
      activeScrollCharacter=key;
      state.supplyScrollPurchased=scrollPurchaseLocks[key]===true;
    }
    // Ponowny zakup dopiero po nowym przejściu z >=10 na <10.
    // Samo zużycie kolejnego zwoju przy zapasie np. 6 -> 5 NIE resetuje blokady.
    if(amount>=SUPPLY.scrollThreshold && state.supplyScrollPurchased)setScrollPurchaseLock(g,false);
    return true;
  }
  const itemStats=item=> {
    const original=item?.d??item??{}, cached=original._cachedStats||{}, extra=original.stats||{};
    const stat=String(original.stat??original.statsString??cached.stat??'');
    const kv={};for(const chunk of stat.split(';')){const i=chunk.indexOf('=');if(i>0)kv[chunk.slice(0,i).trim().toLowerCase()]=chunk.slice(i+1).trim();}
    return {...cached,...extra,...kv,...original};
  };
  const invLoc=item=>String(item?.loc??item?.location??item?.container??item?.locationType??'').toLowerCase();
  function inventorySnapshot(g){
    if(inventoryCached?.serial===tickSerial && inventoryCached.engine===g)return inventoryCached.data;
    const cache=result=>{inventoryCached={serial:tickSerial,engine:g,data:result};return result;};
    const sources=[];
    for(const root of [g?.items,ROOT.Engine?.items]){
      if(typeof root?.fetchLocationItems==='function'){
        try{const v=root.fetchLocationItems('g');if(v){const a=toArray(v);if(a.length)sources.push({items:a,authoritative:true,source:'fetchLocationItems(g)'});}}catch{}
      }
    }
    // New interface sometimes stores items under g.item rather than Engine.items.
    for(const root of [g?.item,g?.items?.getList?.(),g?.items?.items,g?.inventory,g?.hero?.items]){
      if(!root)continue;
      try{sources.push({items:toArray(root),authoritative:false,source:'g.item / collection'});}catch{}
    }
    const first=sources.find(x=>x.authoritative);
    if(first?.items?.length){
      const found=new Map();for(const raw of first.items){const d=itemStats(raw);if(d.id!=null)found.set(String(d.id),{...d,loc:d.loc??'g'});}
      if(found.size)return cache({items:[...found.values()],readable:true,source:first.source});
    }
    const found=new Map();let observed=0;
    for(const source of sources){for(const raw of source.items){const d=itemStats(raw);if(d.id==null)continue;
      observed++;if(['g','bag','inventory','plecak'].includes(invLoc(d)))found.set(String(d.id),d);
    }}
    return cache({items:[...found.values()],readable:found.size>0 || !!first,source:found.size?'g.item / fallback':(first?.source||'g.item / fallback'),observed});
  }
  const quantity=item=> {
    const d=itemStats(item);
    for(const v of [d.amount,d.count,d.quantity,d.stack,d.q,d.stacks]){
      const n=Number(v);if(Number.isFinite(n)&&n>0)return n;
    }
    return 1;
  };
  // Actual 2026 Margonem shop is a .c-window, not the legacy #shop.
  // Its merchant stock lives in .shop-items; confirmation is
  // .finalize-button .button (public AutoQuester, September 2026).
  function shopWindow(){
    if(typeof document==='undefined')return null;
    const visible=el=>!!(el?.isConnected && el.getClientRects?.().length &&
      getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none');
    const stock=[...document.querySelectorAll('.shop-items,[class*="merchant-items"],.shop-assortment')]
      .find(visible);
    if(!stock)return null;
    const all=[...document.querySelectorAll('.c-window,.shop-window,#shop,[class*="shop-window"],.shop-wrapper')]
      .filter(el=>visible(el)&&el.contains(stock));
    all.sort((a,b)=>(a.querySelectorAll('*').length-b.querySelectorAll('*').length));
    const hasConfirm=el=>[...el.querySelectorAll('.finalize-button .button,.finalize-button button,.shop-accept,button,[role="button"]')]
      .some(b=>visible(b)&&/akceptuj|zatwierdz|potwierdz/i.test(norm(b.textContent||'')));
    // Najpierw okno z prawdziwym towarem i przyciskiem zatwierdzania.
    const exact=all.find(hasConfirm);
    if(exact)return exact;
    const title=all.find(el=>/sklep/i.test(norm(el.querySelector('.header-label .text,.window-title,.title')?.textContent||'')));
    if(title)return title;
    // Awaryjnie wspólny rodzic towarów i przycisku (nigdy całe body).
    let parent=stock;
    for(let i=0;i<9&&parent&&parent!==document.body;i++,parent=parent.parentElement){
      if(hasConfirm(parent))return parent;
    }
    return all[0]||null;
  }
  const shopVisible=()=>!!shopWindow();
  // Okno sklepu bywa elementem wewnętrznym .border-window / .c-window.
  // Krzyżyk X może znajdować się w RODZICU, poza shopWindow(), więc stara
  // wersja nie znajdowała go mimo poprawnego zamknięcia ręcznie.
  function closeShop(){
    const win=shopWindow();
    if(!win)return true;
    const visible=el=>!!(el?.isConnected && el.getClientRects?.().length &&
      getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none');
    const selectors=[
      '.close-button-corner-decor .close-button',
      '.window-close .close-button',
      '.close-button',
      '.window-close',
      '.close-window',
      '.close-btn',
      '[data-action="close"]',
      '[aria-label="Zamknij"]',
      '[title="Zamknij"]',
      '[aria-label="Close"]'
    ];
    const scopes=[];
    let node=win;
    // Szukaj w oknie sklepu i jego ramce, NIGDY w document.body.
    for(let i=0;node && node!==document.body && i<6;i++,node=node.parentElement){
      scopes.push(node);
    }
    const wr=win.getBoundingClientRect();
    for(const scope of scopes){
      const reference=scope===win?wr:scope.getBoundingClientRect();
      const candidates=[];
      for(const sel of selectors){
        for(const button of scope.querySelectorAll(sel)){
          if(!visible(button) || button.disabled || button.getAttribute('aria-disabled')==='true')continue;
          if(candidates.includes(button))continue;
          const r=button.getBoundingClientRect();
          if(!r.width||!r.height)continue;
          // Nie zamykamy innego okna, jeśli w nadrzędnym kontenerze jest ich kilka.
          // X powinien leżeć blisko górnej/prawej krawędzi sklepu.
          const dx=Math.abs(r.right-reference.right),dy=Math.abs(r.top-reference.top);
          if(dx>160 || dy>115)continue;
          candidates.push(button);
        }
      }
      if(candidates.length){
        candidates.sort((a,b)=>{
          const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
          return Math.abs(ra.right-reference.right)+Math.abs(ra.top-reference.top)-
            Math.abs(rb.right-reference.right)-Math.abs(rb.top-reference.top);
        });
        candidates[0].click();
        return true;
      }
    }
    return false;
  }
  // Akceptuj jest elementem .finalize-button .button. Szukamy wewnątrz
  // właściwego okna; nie klikamy podobnych napisów w innych panelach.
  function shopAcceptButton(){
    const win=shopWindow();if(!win)return null;
    const visible=el=>!!(el?.isConnected&&el.getClientRects?.().length)&&
      getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).display!=='none';
    const buttons=[...win.querySelectorAll('.finalize-button .button,.finalize-button button,.shop-accept,[data-action="accept"],button,[role="button"]')];
    const matches=el=>/^(?:akceptuj|zatwierdz|potwierdz)(?: transakcje| zakup| sprzedaz)?$/.test(norm(el.innerText||el.textContent||''));
    return buttons.find(el=>visible(el)&&el.closest('.finalize-button')&&matches(el))||
      buttons.find(el=>visible(el)&&matches(el))||null;
  }
  function acceptShop(){
    const btn=shopAcceptButton();
    if(!btn||btn.disabled||btn.getAttribute('aria-disabled')==='true'||
      /(?:^|\s)(?:disabled|disable|inactive)(?:\s|$)/i.test(String(btn.className)))return false;
    btn.click();return true;
  }
  // Niektóre wersje gry pokazują jeszcze jedno potwierdzenie po Akceptuj.
  function confirmShopModal(){
    const dialogs=[...document.querySelectorAll('.c-window,.dialog-window,.modal,[role="dialog"],.confirm-window,.confirmation-window,.mAlert-layer')]
      .filter(el=>el.getClientRects?.().length && el!==shopWindow() && !shopWindow()?.contains(el));
    for(const dialog of dialogs){
      const txt=norm(dialog.textContent||'');
      if(!/czy na pewno|potwierdz|zatwierdz|transakcj|sprzedaz|zakup/.test(txt))continue;
      const choices=[...dialog.querySelectorAll('button,.button,[role="button"],.alert-accept-hotkey')];
      const yes=choices.find(el=>el.matches?.('.alert-accept-hotkey')||/^(?:tak|akceptuj|potwierdz|zatwierdz)$/.test(norm(el.textContent||'')));
      if(yes&&!yes.disabled){yes.click();return true;}
    }
    return false;
  }
  function domItemId(el){
    const cls=String(el?.className||'');
    return cls.match(/(?:^|\s)item-id-(\d+)(?:\s|$)/)?.[1]||
      el?.getAttribute?.('data-item-id')||el?.getAttribute?.('data-id')||
      String(el?.id||'').match(/^item(\d+)$/)?.[1]||null;
  }
  // Stare wersje usuwały przedmiot z widoku plecaka już po przeniesieniu
  // do koszyka. Nie można wtedy szukać go ponownie tylko w loc='g'.
  // Potwierdzamy zwykłą jakość na podstawie typu widocznego przedmiotu
  // albo jego oryginalnych danych w silniku, niezależnie od lokacji.
  function cartItemIsOrdinary(el,g){
    if(!el)return false;
    const cls=String(el.className||'');
    const typeNodes=[el,...el.querySelectorAll('[data-item-type],[data-rarity],[data-quality]')];
    const types=typeNodes.map(x=>String(x.getAttribute?.('data-item-type')||'').toLowerCase()).filter(Boolean);
    if(types.some(x=>x!=='t-norm'))return false;
    const id=domItemId(el);
    const roots=[g?.item,g?.items?.getList?.(),g?.items?.items,g?.shop?.items,ROOT.g?.item];
    try{for(const place of ['g','s','shop','p'])roots.push(g?.items?.fetchLocationItems?.(place));}catch{}
    let info=null;
    for(const root of roots){
      if(!root)continue;
      try{for(const raw of toArray(root)){
        const d=itemStats(raw);if(String(d.id)===String(id)){info=d;break;}
      }}catch{}
      if(info)break;
    }
    if(info){
      const name=norm(String(info.name||info.nick||''));
      if(/mikstur|eliksir|teleport|zwoj|quest|klucz|torba|plecak/.test(name)||
          info.quest===true||info.canSell===false||info.locked||info.isLocked)return false;
      const typ=String(info.type||'').toLowerCase();
      const rarity=norm(info.rarity??info.rare??info.quality??info.rank??info.cl??'');
      if(typ.startsWith('t-')&&typ!=='t-norm')return false;
      if(rarity&&!['0','normal','common','ordinary','zwykly','white'].includes(rarity))return false;
    }
    if(types.includes('t-norm'))return true;
    const ranks=typeNodes.flatMap(x=>[x.getAttribute?.('data-rarity'),x.getAttribute?.('data-quality')])
      .filter(Boolean).map(x=>norm(x));
    if(ranks.some(x=>!['0','normal','common','ordinary','zwykly','white'].includes(x)))return false;
    if(ranks.length)return true;
    if(/(?:^|\s)(?:t-uni|t-her|t-leg|item-rare|item-heroic|item-legendary)(?:\s|$)/i.test(cls))return false;
    if(!id||!info)return false;
    const rarity=norm(info.rarity??info.rare??info.quality??info.rank??info.cl??'');
    const typ=String(info.type||'').toLowerCase();
    return typ==='t-norm'||['common','normal','ordinary','zwykly','white','0'].includes(rarity);
    return false;
  }
  function approvedSellCartMatches(p){
    const cells=basketItems('sell');
    if(!cells?.length||cells.length!==(p.ids?.length||0))return false;
    if(p.manualApproved)return true; // explicit click in our recovery panel
    if(p.recovered)return cells.every(el=>cartItemIsOrdinary(el,getEngineSafe()));
    // Current run: only ids that we ourselves placed in the basket.
    const known=cells.map(domItemId).filter(Boolean).map(String);
    if(known.some(id=>!p.ids.includes(id)))return false;
    // Missing DOM IDs are acceptable only for slots proven to have grown
    // directly after clicking an already-qualified ordinary item.
    return known.length===0 ? cells.length===p.ids.length :
      known.every((id,i,a)=>a.indexOf(id)===i);
  }
  function shopItemElement(item){
    const win=shopWindow(),id=String(item?.id??''),tpl=String(item?.tpl??item?.templateId??'');
    if(!win)return null;
    const stock=win.querySelector('.shop-items,[class*="merchant-items"],.shop-assortment');
    if(!stock)return null;
    const elems=[...stock.querySelectorAll('[class*="item-id-"],[class*="item-tpl-"],[data-item-id],[data-id]')];
    const leaves=elems.filter(el=>!elems.some(other=>other!==el&&el.contains(other)));
    return leaves.find(el=>domItemId(el)===id)||
      leaves.find(el=>tpl&&String(el.className).split(/\s+/).includes('item-tpl-'+tpl))||null;
  }
  // Sklep działa na kliknięciu przedmiotu W PLECAKU, nie w ekwipunku
  // założonym ani w asortymencie kupca. W NI klasy mogą różnić się od .inventory-grid.
  function bagItemElement(item){
    if(typeof document==='undefined')return null;
    const id=String(item?.id??'');if(!/^\d+$/.test(id))return null;
    const win=shopWindow();
    const selectors=[`.inventory-item.item-id-${id}`,`.item-id-${id}.inventory-item`,
      `.inventory-grid .item-id-${id}`,`.bag-items .item-id-${id}`,
      `.inventory-bag .item-id-${id}`,`.inventory-wrapper .item-id-${id}`,
      `[data-item-id="${id}"].inventory-item`,`[data-id="${id}"].inventory-item`];
    const candidates=[...new Set(selectors.flatMap(q=>[...document.querySelectorAll(q)]))];
    const isVisible=el=>!!el?.isConnected && el.getClientRects().length>0 &&
      getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none';
    const inEquipment=el=>!!el.closest('.equipment-wrapper,.equipment-items,.equipment-grid,.eq-items,.eq-slot,.equipment-slot,.hero-equipment,.outfit-card,.shop-items');
    const scored=candidates.filter(el=>isVisible(el)&&!win?.contains(el)&&!inEquipment(el))
      .map(el=>{
        let score=0;
        if(el.matches('.inventory-item'))score+=15;
        if(el.closest('.inventory-grid,.bag-items,.inventory-bag,.bag-grid,.inventory-slots'))score+=25;
        if(el.closest('.inventory-wrapper,.inventory-window,.inventory-panel'))score+=5;
        const r=el.getBoundingClientRect();
        if(r.width>=16&&r.width<=60&&r.height>=16&&r.height<=60)score+=5;
        if(el.querySelector('.inventory-item,[class*="item-id-"]'))score-=12;
        return {el,score};
      }).sort((a,b)=>b.score-a.score);
    return scored[0]?.el??null;
  }
  function freeBagSlots(){
    if(typeof document==='undefined')return null;
    // Old and new clients expose free slot counts differently. Only use visible numeric counts.
    const bagIds=['bs0','bs1','bs2'];let vals=[];
    for(const id of bagIds){const el=document.getElementById(id);if(!el)continue;const txt=el.textContent?.trim();if(/^\d{1,3}$/.test(txt))vals.push(Number(txt));}
    if(vals.length===3)return vals.reduce((a,b)=>a+b,0);
    // The new UI exposes actual .inventory-grid slots (not the three bag labels).
    // Never assume a 28/42 slot capacity if no explicit slots were identified.
    const grids=[...document.querySelectorAll('.inventory-grid')].filter(el=>el.getClientRects?.().length>0);
    if(grids.length){
      let slots=0,occupied=0;
      for(const grid of grids){
        const nodes=grid.querySelectorAll('.inventory-slot,.bag-slot,.slot-cell');
        if(!nodes.length)continue;
        slots+=nodes.length;
        occupied+=grid.querySelectorAll('.inventory-item').length;
      }
      if(slots>0 && occupied<=slots)return slots-occupied;
    }
    // Fallback: some client versions render occupied inventory cells without
    // .inventory-slot elements. Only trust a complete, visible slot grid.
    const containers=[...document.querySelectorAll('.inventory-grid,.bag-items')].filter(
      el=>el.getClientRects?.().length>0
    );
    for(const container of containers){
      const cells=[...container.children].filter(el=>
        el.matches?.('.inventory-slot,.bag-slot,.slot-cell,[data-slot]'));
      if(cells.length>=10){
        const empty=cells.filter(el=>
          !el.matches('.inventory-item,[class*="item-id-"]') &&
          !el.querySelector('.inventory-item,[class*="item-id-"]')
        ).length;
        return empty;
      }
    }
    // New client: inventory grid may contain item elements only, with empty
    // positions drawn by CSS rather than individual .inventory-slot nodes.
    // Derive capacity only from a measurable visible grid and its actual item
    // cell dimensions; never assume a fixed 42-slot bag.
    for(const grid of [...document.querySelectorAll('.inventory-grid,.bag-items,.inventory-slots')]){
      if(!grid.getClientRects?.().length)continue;
      const r=grid.getBoundingClientRect();
      const els=[...grid.querySelectorAll('.inventory-item')].filter(el=>el.getClientRects?.().length);
      if(!els.length || r.width<100 || r.height<100)continue;
      const widths=els.map(el=>el.getBoundingClientRect().width).filter(v=>v>=20&&v<=65);
      const heights=els.map(el=>el.getBoundingClientRect().height).filter(v=>v>=20&&v<=65);
      if(!widths.length||!heights.length)continue;
      const cw=widths.sort((a,b)=>a-b)[Math.floor(widths.length/2)];
      const ch=heights.sort((a,b)=>a-b)[Math.floor(heights.length/2)];
      const cols=Math.round(r.width/cw),rows=Math.round(r.height/ch);
      if(cols<3||cols>12||rows<3||rows>15)continue;
      if(Math.abs(r.width-cols*cw)>cw*.35||Math.abs(r.height-rows*ch)>ch*.35)continue;
      const capacity=cols*rows;
      if(els.length<=capacity)return capacity-els.length;
    }
    return null;
  }
  function supplyCounts(g){
    const snapshot=inventorySnapshot(g),items=snapshot.items;
    const scrolls=items.filter(x=>keyNorm(x.name??x.nick)===keyNorm(SUPPLY.scrollName)).reduce((v,x)=>v+quantity(x),0);
    const potions=items.filter(x=>keyNorm(x.name??x.nick??'')===keyNorm(SUPPLY.potionName)).reduce((v,x)=>v+quantity(x),0);
    const free=freeBagSlots();
    // A hardcoded '42 slots' cannot be trusted with extra bags. Only use explicit empty slot evidence.
    return {slots:items.length,bagFull:free===0,freeSlots:free,potions,scrolls,items,readable:snapshot.readable,source:snapshot.source};
  }
  function isPotion(item){
    const d=itemStats(item),name=norm(d.name??d.nick??'');
    return !/teleport|zwoj|klucz/.test(name) && (/mikstur|eliksir|potka|potion|napoj lecz|napar lecz/.test(name) || (/leczy=|fullheal=|perheal=/.test(String(d.stat??'')) && /mikstur|lecz|eliksir/.test(name)));
  }
  function safeOrdinary(item){
    const d=itemStats(item);if(d.id==null)return false;
    const loc=invLoc(d);if(loc && !['g','bag','inventory','plecak'].includes(loc))return false;
    if(d.equipped||d.bound||d.permbound||d.canSell===false||d.quest===true||d.locked||d.isLocked)return false;
    const description=norm(String(d.name??'')+' '+String(d.tip??'')+' '+String(d.type??''));
    if(/mikstur|eliksir|potka|potion|lecz|teleport|zwoj|klucz|quest|torba|unikat|heroik|legend|artefakt|błogosław|konsumpcyj|intensyfikac|wzmocnien|błogosławieństw|plecak|przekl/.test(description))return false;
    // Actual 2026 DOM: <div class="item item-id-123 inventory-item SHOP-disable disable-item-mark" ...>.
    // Even a t-norm item can be non-tradable (e.g. currency). Never click those.
    if(shopVisible()){
      const element=bagItemElement(d);
      if(!element)return false; // Not in a rendered bag tab: do not guess a sell command.
      const classes=String(element.className||'');
      if(/(?:^|\s)(?:SHOP-disable|disable-item-mark|disabled|item-locked)(?:\s|$)/i.test(classes))return false;
      if(element.getAttribute?.('data-item-type') && element.getAttribute('data-item-type')!=='t-norm')return false;
    }
    const rarity=String(d.rarity??d.rare??d.quality??d.rank??d.cl??'').toLowerCase();
    // Explicitly recognized ordinary rarity only. No assumptions on unknown metadata.
    // Tier 0 in item data is ordinary; 'white' is accepted only if explicitly stated.
    const explicitNormal=['common','normal','ordinary','zwykly','zwykły','white','0'].includes(rarity);
    const type=String(d.type??'').toLowerCase();
    if(type.startsWith('t-') && type!=='t-norm')return false;
    const inBag=bagItemElement(d);
    const normalType=type==='t-norm'||inBag?.getAttribute?.('data-item-type')==='t-norm'||String(d.cl??'')==='0';
    return explicitNormal || (!rarity && normalType);
  }
  function rawShopItems(g){
    const result=new Map();
    const add=(raw,source)=>{
      const d=itemStats(raw);if(d.id==null)return;
      const id=String(d.id);if(!/^\d+$/.test(id))return;
      const value={...d,_shopSource:source};
      const prev=result.get(id);
      if(!prev || Object.keys(value).length>Object.keys(prev).length)result.set(id,value);
    };
    const sources=[g?.shop?.items,g?.shop?.d?.items,g?.merchant?.items];
    for(const fetcher of [
      ()=>g?.shop?.getList?.(),
      ()=>g?.items?.fetchLocationItems?.('s'),
      ()=>g?.items?.fetchLocationItems?.('n'),
      ()=>g?.items?.fetchLocationItems?.('shop'),
      ()=>g?.items?.getList?.(),
      ()=>ROOT.Engine?.items?.fetchLocationItems?.('n'),
      ()=>ROOT.Engine?.items?.getViews?.('shop'),
      ()=>ROOT.Engine?.items?.getViews?.('n'),
      ()=>ROOT.Engine?.items?.getViews?.('merchant')
    ]){try{sources.push(fetcher());}catch{}}
    for(const root of sources){try{for(const raw of toArray(root)){
      const d=itemStats(raw);if(!d.id)continue;
      // Broad catalog data may include the bag. Only accept explicit merchant locations,
      // unless sourced directly from the shop or n-location collection.
      const loc=invLoc(d);
      if(['g','bag','inventory','plecak'].includes(loc))continue;
      add(d,'shop collection');
    }}catch{}}
    for(const raw of toArray(g?.item)){
      const d=itemStats(raw);
      if(['n','s','shop','merchant','t'].includes(invLoc(d)))add(d,'g.item location');
    }
    // Link the merchant's visible item IDs to Engine item metadata. A DOM icon
    // alone does not provide reliable healing or price numbers: do not invent them.
    const win=shopWindow();
    if(win){
      const stock=win.querySelector('.shop-items,[class*="merchant-items"],.shop-assortment');
      for(const el of stock?.querySelectorAll('[class*="item-id-"],[data-item-id]')||[]){
        const id=domItemId(el);if(!id)continue;
        let known=result.get(id);
        if(!known){
          const tryItem=fn=>{try{return fn();}catch{return null;}};
          for(const candidate of [g?.item?.[id],g?.items?.items?.[id],
            tryItem(()=>g?.items?.getItem?.(id)),tryItem(()=>g?.items?.getItemById?.(id)),
            tryItem(()=>ROOT.Engine?.items?.getItemById?.(id))]){
            if(!candidate)continue;
            const d=itemStats(candidate);if(d?.id!=null){known={...d,_shopSource:'engine lookup'};break;}
          }
        }
        const dataset=el.dataset||{};
        result.set(id,{...(known||{}),id,
          name:known?.name||known?.nick||dataset.name||el.getAttribute?.('data-name')||el.getAttribute?.('title')||el.getAttribute?.('aria-label')||'',
          tpl:known?.tpl??known?.templateId??el.getAttribute?.('data-tpl')??String(el.className).match(/(?:^|\s)item-tpl-(\d+)(?:\s|$)/)?.[1],
          price:known?.price??dataset.price,tip:known?.tip||dataset.tip||'',
          stat:known?.stat||dataset.stat||'',
          amount:known?.amount??(el.querySelector?.('.amount')?.textContent?.trim()||null),
          _shopElementPresent:true});
      }
    }
    return [...result.values()];
  }
  function healAmount(item,g){
    const d=itemStats(item),stat=String(d.stat??''), maxhp=Number(g?.hero?.d?.warrior_stats?.maxhp||0);
    const direct=Number(d.leczy??d.heal??d.healing??0);
    if(direct>0)return direct;
    let m=stat.match(/(?:^|;)leczy=(\d+)/);if(m)return Number(m[1]);
    m=stat.match(/(?:^|;)(?:fullheal|perheal)=(\d+)/);if(m&&maxhp)return maxhp*Number(m[1])/100;
    return 0;
  }
  function pickPotion(g){
    // Exact user-selected potion. Do not infer its name, healing or price from an incomplete shop API.
    const wanted=keyNorm(SUPPLY.potionName);
    return rawShopItems(g).find(x=>keyNorm(x.name??x.nick??'')===wanted && shopItemElement(x))||null;
  }
  function pickScroll(g){
    return rawShopItems(g).find(x=>keyNorm(x.name)===keyNorm(SUPPLY.scrollName) && shopItemElement(x))||null;
  }
  function dialogueState(){
    if(typeof document==='undefined')return {visible:false,choices:[],text:''};
    const visible=x=>!!x && (x.getClientRects?.().length>0 || x.offsetParent!==null);
    const selectors=['#dialogue','#dialog','#replies','#npc-dialog','.npc-dialog','.dialogue-window','.dialog-window'];
    let roots=[...new Set(selectors.flatMap(q=>[...document.querySelectorAll(q)]))].filter(visible);
    const answerSelector='.dialogue-window-answer,.dialog-answer,.answer,.dialogue-option';
    if(!roots.length){
      const answer=[...document.querySelectorAll(answerSelector)].find(visible);
      if(answer)roots=[answer.closest('.c-window,[class*="dialogue"],[id*="dialog"]')||answer.parentElement].filter(Boolean);
    }
    if(!roots.length)return {visible:false,choices:[],text:''};
    const root=roots.sort((a,b)=>(b.textContent||'').length-(a.textContent||'').length)[0];
    const modern=[...root.querySelectorAll(answerSelector)].filter(visible);
    const elements=modern.length?modern:[...root.querySelectorAll('li,button,a,[role="button"],[onclick],.reply,.option')].filter(visible);
    const choices=[...new Set(elements)].filter(x=>norm(x.textContent||'').trim().length>0)
      .sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length);
    return {visible:true,text:norm(root.textContent||''),choices};
  }
  function talkReply(){
    const dialog=dialogueState(),now=Date.now();
    if(!dialog.visible)return 'none';
    if(!state.dialogStartedAt)state.dialogStartedAt=now;
    if(now-state.dialogStartedAt>45000)return 'stalled';
    if(now-(state.lastDialogueClickAt||0)<1800)return 'waiting';
    const label=x=>norm(x.textContent||'').replace(/^\s*\d+\.\s*/, '').trim();
    const patterns=[
      /moze\s+pohandlujemy|pohandlujemy|handlujemy|pokaz\s+mi.*sprzedaz|co\s+masz\s+na\s+sprzedaz|otworz\s+sklep|chce\s+(kupic|sprzedac)|twoj\s+asortyment|pokaz.*towar|zobaczyc.*ofert/,
      /moze\s+zrobisz\s+dla\s+mnie\s+wyjatek/,
      /^(dalej|kontynuuj)\s*$/
    ];
    const target=patterns.map(re=>dialog.choices.find(x=>re.test(label(x)))).find(Boolean);
    if(!target){
      if(/nie handluje z nieznajomymi/.test(dialog.text))return 'blocked';
      return 'waiting';
    }
    // A click is allowed once for each *distinct dialogue state*. The previous
    // implementation kept restarting the conversation and clicking old answers.
    const signature=dialog.text+'|'+label(target);
    if(state.lastDialogueSignature===signature){
      if(now-(state.lastDialogueClickAt||0)>12000)return 'stalled';
      return 'waiting';
    }
    if((state.dialogueClickCount||0)>=12)return 'stalled';
    state.lastDialogueSignature=signature;
    state.lastDialogueClickAt=now;
    state.dialogueClickCount=(state.dialogueClickCount||0)+1;
    const engine=getEngineSafe();
    const answers=[...document.querySelectorAll('.dialogue-window-answer,.dialog-answer,.answer')]
      .filter(el=>el.getClientRects?.().length>0||el.offsetParent!==null);
    const idx=answers.indexOf(target);
    if(idx>=0 && typeof engine?.dialogue?.choose==='function'){
      try{engine.dialogue.choose(idx);return 'clicked';}catch(e){console.warn('[MF61] Wybór odpowiedzi przez Engine:',e);}
    }
    target.click();
    return 'clicked';
  }
  function request(command){
    if(typeof ROOT._g!=='function')return false;
    try{ROOT._g(command);return true;}catch(e){status('Błąd polecenia sklepu: '+String(e?.message||e),'SKLEP');return false;}
  }
  // MargoWorld: Tunia Frupotius, ID 16366, Dom Tunii (mapa 353), pole (7,9).
  // W wersji 61 regex zawierał literówkę „Froputis”, przez co nigdy nie pasował.
  const isTuniaName=name=>/^tunia(?:\s+frupotius)?$/.test(norm(name).trim());
  function findTunia(g,pos){
    if(currentMap(g)!==SUPPLY.tuniaMap)return null;
    const nearby=(x,y,max=4)=>{
      const nx=numeric(x),ny=numeric(y);
      return !Number.isFinite(nx)||!Number.isFinite(ny)||
        Math.abs(nx-SUPPLY.merchantX)+Math.abs(ny-SUPPLY.merchantNpcY)<=max;
    };
    // 1. Preferuj aktywne ID na mapie, jeżeli gra ujawnia prawdziwe imię.
    const match=getCharacters(g).find(x=>isTuniaName(x.d.nick??x.d.name) &&
      goodId(x.id) && nearby(x.d.x,x.d.y));
    if(match)return {id:String(match.id),source:'lista NPC'};
    // 2. Niektóre wersje silnika nie uwzględniają handlarzy w check()/getList().
    //    Spróbuj bezpośredniego odczytu *konkretnego* identyfikatora, bez skanowania innych NPC.
    const id=String(SUPPLY.merchantId);
    const readers=[
      ()=>g?.npcs?.getById?.(SUPPLY.merchantId),
      ()=>g?.npcs?.get?.(SUPPLY.merchantId),
      ()=>g?.npcs?.npcs?.[id],
      ()=>g?.npc?.[id],
      ()=>ROOT.g?.npc?.[id]
    ];
    for(const read of readers){
      let npc;try{npc=read();}catch{continue;}
      if(!npc)continue;
      const d=npc.d??npc;
      if(d.id!=null&&String(d.id)!==id)continue;
      const name=d.nick??d.name??'';
      if(name&&!isTuniaName(name))continue;
      if(!nearby(d.x,d.y))continue;
      return {id,source:'NPC po ID'};
    }
    // 3. Awaryjnie użyj udokumentowanego ID TYLKO w Domu Tunii i stojąc przy
    //    potwierdzonym położeniu (7,9), nigdy na losowej mapie / z daleka.
    if(pos && Math.abs(pos.x-SUPPLY.merchantX)+
       Math.abs(pos.y-SUPPLY.merchantNpcY)<=3){
      return {id,source:'zweryfikowane ID na mapie 353'};
    }
    return null;
  }
  function openTunia(g){
    const now=Date.now(),pos=position(g);if(!pos)return;
    if(currentMap(g)!==SUPPLY.tuniaMap)return;
    const dist=Math.abs(pos.x-SUPPLY.merchantX)+Math.abs(pos.y-SUPPLY.merchantY);
    if(dist>2){
      if(now-state.lastAction>1200){state.lastAction=now;try{g.hero.autoGoTo?.({x:SUPPLY.merchantX,y:SUPPLY.merchantY});}catch(e){failStop('Nie mogę dojść do Tunii: '+String(e?.message||e));}}
      status('Podchodzę do Tunii.','SKLEP');return;
    }
    if(shopVisible()){state.shopStep='trade';status('Sklep otwarty — sprawdzam ekwipunek i ofertę.','SKLEP');return;}
    if(!state.shopOpenAt)state.shopOpenAt=now;
    if(now-state.shopOpenAt>60000){pauseTrade('Nie mogę otworzyć sklepu Tunii (60 s).');return;}
    // Nie wywołuj kolejnego polecenia talk, gdy otwarty jest dialog.
    const reply=talkReply();
    if(reply==='blocked'){
      pauseTrade('Tunia odmawia handlu: „Nie handluję z nieznajomymi”. Wymagane są warunki rozmowy/questu w grze.');
      return;
    }
    if(reply==='clicked'){
      state.shopReplyAt=now;status('Tunia: przechodzę do następnego etapu rozmowy.','SKLEP');return;
    }
    if(reply==='stalled'){
      pauseTrade('Dialog Tunii nie zmienił się po kliknięciu odpowiedzi. Nie ponawiam jej w pętli.');
      return;
    }
    if(reply==='waiting'){status('Czekam na odpowiedź dialogową Tunii.','SKLEP');return;}
    if(state.dialogueClickCount>0)return;
    if(now-state.shopTalkAt>5500){
      if(state.shopTalkAttempts>=3){
        pauseTrade('Tunia nie otworzyła dialogu po 3 próbach. Sprawdź, czy możesz z nią porozmawiać ręcznie.');
        return;
      }
      const npc=findTunia(g,pos);
      if(!npc){status('Nie potwierdzono Tunii obok pola (7,9); czekam na załadowanie NPC.','SKLEP');return;}
      if(request('talk&id='+encodeURIComponent(npc.id))){
        state.shopTalkAt=now;state.shopTalkAttempts++;
        status('Rozmawiam z Tunią ('+npc.source+', próba '+state.shopTalkAttempts+'/3).','SKLEP');
      }
    }
  }
  function pauseTrade(message){
    state.shopError=message;state.shopStep='error';state.shopPending=null;
    failStop(message+' Nie kupuję ani nie sprzedaję bez potwierdzenia.','SKLEP BŁĄD');
  }
  // Public AutoQuester 28.09.2026 confirms .shop-items .item-id-N click and
  // .finalize-button .button click. No raw shop network commands whatsoever.
  const SELL_BATCH_HARD_LIMIT=20; // Shop decides the real capacity; this only prevents runaway loops.
  // W nowym UI koszyki nie muszą mieć #shop_sell/#shop_buy.
  // Szukamy najpierw kontenerów nazwanych, a potem geometrycznie sekcji
  // "Kupno" i "Sprzedaż" po prawej stronie asortymentu. Nigdy nie liczymy
  // widocznych przedmiotów ze stoiska ani plecaka jako koszyka.
  function basketItems(side){
    const win=shopWindow();if(!win)return null;
    const stock=win.querySelector('.shop-items,[class*="merchant-items"],.shop-assortment');
    if(!stock)return null;
    const rect=el=>{try{const r=el?.getBoundingClientRect?.();return r?.width>0&&r?.height>0?r:null;}catch{return null;}};
    const leaves=root=>{
      const all=[...root.querySelectorAll('.item,[class*="item-id-"],[data-item-id]')]
        .filter(el=>rect(el)&&!stock.contains(el)&&!el.closest('.inventory-grid,.bag-items,.equipment-items'));
      return all.filter(el=>!all.some(other=>other!==el&&el.contains(other)));
    };
    const selectors=side==='sell'?
      ['#shop_sell','#shop-sell','.sell-items','.shop-sell-items','.selling-items','.sell-grid','.shop-sell-grid','.sell-basket','.basket-sell','[data-basket="sell"]','[data-shop-basket="sell"]']:
      ['#shop_buy','#shop-buy','.buy-items','.shop-buy-items','.buying-items','.buy-grid','.shop-buy-grid','.buy-basket','.basket-buy','[data-basket="buy"]','[data-shop-basket="buy"]'];
    for(const selector of selectors){
      const root=win.querySelector(selector);
      if(root&&root!==stock&&!stock.contains(root)&&rect(root))return leaves(root);
    }
    const sr=rect(stock),wr=rect(win);if(!sr||!wr)return null;
    const labels=[...win.querySelectorAll('span,div,p,label,strong,b,h2,h3,h4')]
      .filter(el=>el.children.length===0&&rect(el)&&!stock.contains(el))
      .map(el=>({el,t:norm(el.textContent||''),r:rect(el)}))
      .filter(x=>x.r.left>=sr.right-30&&x.r.left<wr.right);
    const buy=labels.filter(x=>/^(kup|kupno|zakup|zakupy|kupujesz|kupowane przedmioty|do kupienia)$/.test(x.t));
    const sell=labels.filter(x=>/^(sprzedaj|sprzedaz|sprzedajesz|sprzedawane przedmioty|do sprzedania)$/.test(x.t));
    const pairs=[];
    for(const b of buy)for(const v of sell)if(v.r.top>b.r.top+4){
      const horizontal=Math.abs(b.r.left-v.r.left);
      if(horizontal<Math.max(170,(wr.width-sr.width)*0.8))pairs.push({b,v,horizontal});
    }
    pairs.sort((a,b)=>a.horizontal-b.horizontal);
    if(pairs.length){
      const {b,v}=pairs[0];
      return leaves(win).filter(el=>{
        const r=rect(el),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2;
        return x>sr.right-10 && x<wr.right &&
          (side==='buy'?y>=b.r.bottom&&y<v.r.top:y>=v.r.bottom&&y<wr.bottom);
      });
    }
    // Brak pewnej granicy koszyków: nie udajemy, że są puste.
    return null;
  }
  // Dodatni/ujemny bilans pokazany przez sklep jest kwotą PRZED
  // rozliczeniem. Odczyt opcjonalny: jeżeli etykiety nie ma, nie zgaduj zera.
  function shopBalanceStatus(){
    const win=shopWindow();if(!win)return null;
    const text=String(win.innerText||win.textContent||'').replace(/\u00a0/g,' ');
    const m=text.match(/bilans\s*:\s*([+\-−]?\s*[\d\s.,]+\s*[kKmM]?)/i);
    if(!m)return null;
    const raw=m[1].replace(/\s+/g,'').replace(/[kKmM]$/,'').replace(/[.,]/g,'').replace(/−/g,'-');
    const value=Number(raw);
    return Number.isFinite(value)?(value===0?'zero':'pending'):null;
  }
  // Potwierdzenie może otwierać modal, odświeżać koszyk asynchronicznie
  // albo wymagać powtórnego przyciśnięcia Akceptuj. Nigdy nie zatwierdzamy
  // nieznanych pozycji ani pustej transakcji.
  function sameCartItems(side,ids){
    const cells=basketItems(side);
    return !!cells&&cells.length===ids.length&&cells.length>0&&
      cells.every(el=>!!domItemId(el))&&
      cells.map(domItemId).sort().join(',')===ids.slice().map(String).sort().join(',');
  }
  function sameBuyCart(p){
    const cells=basketItems('buy');
    return !!cells?.length&&cells.every(el=>{
      const id=domItemId(el),tpl=itemTemplateId(el);
      return id===p.itemId || (!!p.itemTpl && tpl===p.itemTpl);
    });
  }
  function basketClearedFor(side){
    const b=shopBasketState();
    return b.open&&b.buy===0&&b.sell===0&&shopBalanceStatus()!=='pending';
  }
  function shopBasketState(){
    const win=shopWindow();if(!win)return {open:false,buy:null,sell:null,balance:null};
    const buy=basketItems('buy'),sell=basketItems('sell');
    const balanceNode=win.querySelector('.shop-balance,.balance-value,.balance');
    return {open:true,buy:buy?.length??null,sell:sell?.length??null,
      balance:balanceNode?balanceNode.textContent?.trim():null};
  }
  // Oddzielamy odczyt koszyka od samego kliknięcia; nie wolno kliknąć
  // ponownie, gdy przedmiot już w nim jest.
  function activateTradeItem(el,method='click'){
    if(!el?.isConnected || !el.getClientRects?.().length)return false;
    if(method==='click'){el.click();return true;}
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const target=el.matches('.item,[class*="item-id-"],.inventory-item')?el:
      el.closest('.item,[class*="item-id-"],.inventory-item')||el;
    // Alternatywna ścieżka tylko po stwierdzeniu, że zwykły click nie zadziałał.
    const init={bubbles:true,cancelable:true,composed:true,clientX:x,clientY:y,button:0,buttons:1,view:window};
    if(typeof PointerEvent==='function'){
      target.dispatchEvent(new PointerEvent('pointerdown',{...init,pointerType:'mouse',isPrimary:true}));
    }
    target.dispatchEvent(new MouseEvent('mousedown',init));
    if(typeof PointerEvent==='function'){
      target.dispatchEvent(new PointerEvent('pointerup',{...init,buttons:0,pointerType:'mouse',isPrimary:true}));
    }
    target.dispatchEvent(new MouseEvent('mouseup',{...init,buttons:0}));
    target.dispatchEvent(new MouseEvent('click',{...init,buttons:0}));
    return true;
  }
  function tradeBagStatus(){
    return {ignored:state.shopSellIgnored?.size||0,checked:state.shopBagIndex||0};
  }
  function shopPendingSuccess(p,c){
    if(p.kind==='sell-batch'){
      return p.ids.every(id=>{
        const was=p.beforeAmounts?.[id]??0;
        const now=c.items.find(x=>String(x.id)===id);
        return !now || quantity(now)<was;
      });
    }
    if(p.kind==='potions')return c.potions>p.before;
    if(p.kind==='scrolls')return c.scrolls>p.before;
    return false;
  }
  function startSellBatch(){
    const b=shopBasketState();
    if(b.sell===null || b.buy===null)return pauseTrade('Nie rozpoznaję koszyków Tunii. Diagnostyka: MF61.inspectShop().');
    if(b.sell!==0||b.buy!==0)return pauseTrade('Nierozliczony koszyk po poprzedniej transakcji (sprzedaż: '+b.sell+', kupno: '+b.buy+').');
    state.shopPending={kind:'sell-batch',phase:'fill',ids:[],beforeAmounts:{},at:Date.now(),lastAt:Date.now(),beforeBasket:shopBasketState()};
    status('Kompletuję partię białych przedmiotów do koszyka.','SPRZEDAŻ');
  }
  function commitSellBatch(p){
    const basket=shopBasketState();
    if(basket.sell===null||basket.sell!==p.ids.length||p.ids.length===0||basket.buy!==0)
      return pauseTrade('Koszyk sprzedaży nie odpowiada wybranym przedmiotom ('+basket.sell+'/'+p.ids.length+').');
    if(!approvedSellCartMatches(p))
      return pauseTrade('Nie można potwierdzić zawartości koszyka sprzedaży — nie zatwierdzam.');
    if(!acceptShop())return pauseTrade('Nie mogę kliknąć Akceptuj w sklepie Tunii.');
    p.phase='verify';p.lastAt=Date.now();p.lastConfirmAt=p.lastAt;
    p.retryCount=0;p.emptySince=0;p.modalChecked=false;
    status('Kliknięto Akceptuj dla '+p.ids.length+' rzeczy. Sprawdzam rozliczenie sklepu.','SPRZEDAŻ');
  }
  function sellBatchTick(p,c,now){
    if(p.phase==='verify'){
      if(now-p.lastConfirmAt>650)confirmShopModal();
      const b=shopBasketState();
      // Ochrona przed fałszywym sukcesem: zniknięcie rzeczy z ekwipunku
      // oznacza też SAMO przeniesienie ich do koszyka.
      if(basketClearedFor('sell') && (p.recovered||shopPendingSuccess(p,c))){
        if(!p.emptySince)p.emptySince=now;
        if(now-p.emptySince>=1400){
          state.shopPending=null;showShopRecoveryButton(false);
          state.shopSellAccepted=(state.shopSellAccepted||0)+p.ids.length;
          status('Sprzedaż rozliczona: '+p.ids.length+' przedmiotów; koszyk pusty.','SPRZEDAŻ');
        }
        return;
      }
      p.emptySince=0;
      if(now-p.lastConfirmAt>3700 && p.retryCount<2){
        // Ponowne Akceptuj wyłącznie z DOKŁADNIE TYM SAMYM koszykiem.
        // Jeżeli koszyk zmienił się, nie próbujemy zatwierdzać na ślepo.
        if(b.sell===p.ids.length&&b.buy===0&&approvedSellCartMatches(p)){
          if(acceptShop()){
            p.retryCount++;p.lastConfirmAt=now;
            status('Koszyk nadal nie rozliczony — ponawiam Akceptuj ('+p.retryCount+'/2).','SPRZEDAŻ');
          }
        }
      }
      if(now-p.lastAt>21000){
        return pauseTrade('Sprzedaż nie została rozliczona. Koszyk: '+b.sell+' rzeczy; bilans '+(shopBalanceStatus()||'nieznany')+'. Przerwano przed zakupami.');
      }
      return;
    }
    const b=shopBasketState();
    if(b.sell===null || b.buy===null)return pauseTrade('Nie rozpoznaję koszyków Tunii podczas sprzedaży.');
    if(b.buy!==0)return pauseTrade('Koszyk kupna jest niepusty podczas sprzedaży.');
    if(p.phase==='wait-item'){
      const basket=basketItems('sell');
      const idFound=basket?.some(el=>domItemId(el)===p.candidateId);
      const grew=b.sell>p.prevCount;
      if(grew && (idFound || basket?.every(el=>!domItemId(el)||domItemId(el)===p.candidateId||p.ids.includes(domItemId(el))))){
        if(b.sell!==p.prevCount+1)return pauseTrade('Do koszyka trafiła nieoczekiwana liczba przedmiotów.');
        p.ids.push(p.candidateId);p.beforeAmounts[p.candidateId]=p.candidateAmount;
        p.phase='fill';p.lastAt=now;
        status('Koszyk sprzedaży: '+p.ids.length+' szt.','SPRZEDAŻ');return;
      }
      // W niektórych wersjach klienta wstawiany element nie ma pola id.
      // Nie zatwierdzamy go w ciemno; wymagamy dopasowania identyfikatora.
      if(grew && !idFound)return pauseTrade('Koszyk zmienił się w nieprzewidziany sposób podczas dodawania.');
      if(now-p.lastAt<1300)return;
      if(!p.retryDone){
        const node=bagItemElement({id:p.candidateId});
        p.retryDone=true;p.lastAt=now;
        if(node){
          activateTradeItem(node,'pointer');
          status('Ponawiam przeniesienie '+p.candidateName+' do koszyka innym kliknięciem.','SPRZEDAŻ');
          return;
        }
      }
      if(now-p.lastAt<1500)return;
      state.shopSellIgnored??=new Set();
      state.shopSellIgnored.add(p.candidateId);
      status('Sklep nie przyjął: '+p.candidateName+'; sprawdzam kolejny przedmiot.','SPRZEDAŻ');
      p.phase=p.ids.length?'commit':'fill';p.lastAt=now;
      return;
    }
    if(p.phase==='commit')return commitSellBatch(p);
    if(b.sell!==p.ids.length)return pauseTrade('Koszyk sprzedaży zmienił się poza skryptem.');
    if(p.ids.length>=SELL_BATCH_HARD_LIMIT){p.phase='commit';return;}
    const excluded=new Set([...p.ids,...(state.shopSellIgnored||[])]);
    const remaining=c.items.filter(x=>!excluded.has(String(x.id))&&safeOrdinary(x));
    if(!remaining.length){
      if(p.ids.length){p.phase='commit';return;}
      state.shopPending=null;return;
    }
    // Wybieraj tylko przedmiot z faktycznie WIDOCZNEGO plecaka;
    // nie wolno wysyłać kliknięcia do elementu założonego w EQ.
    const selected=remaining.map(x=>({item:x,node:bagItemElement(x)})).find(x=>x.node);
    if(!selected){
      state.shopPending=null;
      return;
    }
    const {item,node}=selected;
    p.candidateId=String(item.id);
    p.candidateName=String(item.name||item.nick||item.id);
    p.candidateAmount=quantity(item);p.prevCount=b.sell;
    p.phase='wait-item';p.retryDone=false;p.lastAt=now;
    activateTradeItem(node,'click');
    status('Dodaję do sprzedaży: '+p.candidateName+'.','SPRZEDAŻ');
  }
  // The basket may show either separate item cells or one cell whose amount
  // grows after repeated clicks. Observe both counts and actual UI item state.
  function itemTemplateId(el){
    return String(el?.className||'').match(/(?:^|\s)item-tpl-(\d+)(?:\s|$)/)?.[1]||
      el?.getAttribute?.('data-tpl')||null;
  }
  function buyBasketSignature(){
    const cells=basketItems('buy');
    if(!cells)return null;
    // outerHTML zawiera zmienny stan interfejsu (np. tooltipy), więc nie może
    // służyć za dowód dołożenia kolejnej sztuki do koszyka.
    return JSON.stringify(cells.map(el=>({
      id:domItemId(el),tpl:itemTemplateId(el),
      amount:el.querySelector?.('.amount,.item-amount,.quantity,.count')?.textContent?.trim()||'',
      qty:el.getAttribute?.('data-amount')||el.getAttribute?.('data-count')||
        el.getAttribute?.('data-quantity')||''
    })));
  }
  const MAX_BUY_BATCH_ITEMS=60;
  function verifiedBuyBasket(p){
    const cells=basketItems('buy');
    if(!cells?.length)return false;
    return cells.every(el=>{
      const id=domItemId(el),tpl=itemTemplateId(el);
      return id===p.itemId || (!!p.itemTpl && tpl===p.itemTpl);
    });
  }
  function commitBuyBatch(p){
    const basket=shopBasketState();
    if(basket.buy===null||basket.buy===0||p.added===0||basket.sell!==0)
      return pauseTrade('Koszyk zakupu nie jest gotowy — nie klikam Akceptuj.');
    if(!verifiedBuyBasket(p))return pauseTrade('Koszyk zakupu zawiera nieznany towar — nie zatwierdzam.');
    if(!acceptShop())return pauseTrade('Nie mogę kliknąć Akceptuj przy zakupach.');
    p.phase='verify';p.lastAt=Date.now();p.lastConfirmAt=p.lastAt;
    p.retryCount=0;p.emptySince=0;
    status('Kliknięto Akceptuj zakupów: '+p.added+' opakowań '+p.name+'.','ZAKUPY');
  }
  function shopBuyTick(p,c,now){
    if(p.phase==='verify'){
      if(now-p.lastConfirmAt>650)confirmShopModal();
      const afterBasket=shopBasketState();
      if(shopPendingSuccess(p,c) && basketClearedFor('buy')){
        if(!p.emptySince)p.emptySince=now;
        if(now-p.emptySince<1400)return;
        state.shopPurchaseCount+=p.added;
        if(p.kind==='scrolls'){
          setScrollPurchaseLock(getEngineSafe(),true);
          state.lastSupplyScrollCount=c.scrolls;
          state.supplyScrollGoal=c.scrolls;
        }
        state.shopPending=null;
        status('Zakup rozliczony: '+p.name+'; mikstury '+c.potions+', teleporty '+c.scrolls+'.','ZAKUPY');
        return;
      }
      p.emptySince=0;
      if(now-p.lastConfirmAt>3700 && p.retryCount<2 && afterBasket.sell===0 &&
          afterBasket.buy>0 && sameBuyCart(p)){
        if(acceptShop()){
          p.retryCount++;p.lastConfirmAt=now;
          status('Zakup nadal w koszyku — ponawiam Akceptuj ('+p.retryCount+'/2).','ZAKUPY');
        }
      }
      if(now-p.lastAt>22000)
        return pauseTrade('Zakup nie został rozliczony. Koszyk zakupu: '+afterBasket.buy+', bilans '+(shopBalanceStatus()||'nieznany')+'.');
      return;
    }
    if(p.phase==='wait-item'){
      const b=shopBasketState(),signature=buyBasketSignature();
      if(b.buy!==null && b.buy>0 && (b.buy>p.prevCount || (signature!==null && signature!==p.prevSignature) || (p.prevBalance!=null && b.balance!=null && b.balance!==p.prevBalance))){
        if(!verifiedBuyBasket(p))return pauseTrade('Po kliknięciu nie potwierdzono oczekiwanego przedmiotu w koszyku.');
        p.added++;p.lastAt=now;
        if(p.added>=p.goalClicks || p.added>=MAX_BUY_BATCH_ITEMS){
          p.phase='commit';return;
        }
        p.phase='fill';return;
      }
      if(now-p.lastAt>2200){
        // The merchant refused another click: complete the already-proven basket.
        if(p.added>0){p.phase='commit';return;}
        return pauseTrade('Pierwsze kliknięcie nie dodało towaru do koszyka zakupowego.');
      }
      return;
    }
    if(p.phase==='commit')return commitBuyBatch(p);
    if(p.phase!=='fill')return pauseTrade('Nieznany stan zakupu: '+p.phase);
    const b=shopBasketState();
    if(b.buy===null)return pauseTrade('Utracono odczyt koszyka zakupowego.');
    if(p.added>0&&b.buy===0)return pauseTrade('Koszyk został opróżniony bez potwierdzenia.');
    if(p.added>=p.goalClicks || p.added>=MAX_BUY_BATCH_ITEMS || (p.kind==='scrolls'&&p.added>=1)){p.phase='commit';return;}
    const el=shopItemElement({id:p.itemId,tpl:p.itemTpl});
    if(!el){
      if(p.added){p.phase='commit';return;}
      return pauseTrade('Towar zniknął z listy sklepu.');
    }
    p.prevCount=b.buy;p.prevSignature=buyBasketSignature();p.prevBalance=b.balance;
    p.phase='wait-item';p.lastAt=now;
    el.click();
    status('Napełniam koszyk: '+p.added+'/'+p.goalClicks+' opakowań — '+p.name+'.','ZAKUPY');
  }
  function preparePurchase(kind,item,before){
    if(state.shopPurchaseCount>=180)return pauseTrade('Limit zakupów podczas jednej wizyty.');
    const el=shopItemElement(item);
    if(!el)return pauseTrade('Nie znaleziono towaru w widocznym sklepie.');
    const b=shopBasketState();
    if(b.buy===null || b.sell===null)return pauseTrade('Nie mogę odczytać obu koszyków sklepu.');
    if(b.buy!==0||b.sell!==0)return pauseTrade('Wykryto nierozliczony koszyk przed zakupem (sprzedaż: '+b.sell+', kupno: '+b.buy+'). Nie kupuję w ciemno.');
    // Stan magazynowy sprzedawcy NIE oznacza wielkości pakietu.
    // Tunia sprzedaje teleporty w pakietach po 5: JEDNO kliknięcie = 5 zwojów.
    // Nie wolno liczyć jednego kliknięcia jako jednej sztuki!
    const pack=kind==='potions'?SUPPLY.potionPack:SUPPLY.scrollPack;
    const missing=kind==='potions'?Math.max(0,state.supplyPotionGoal-before):SUPPLY.scrollPack;
    const clicks=kind==='scrolls'?1:Math.max(1,Math.ceil(missing/pack));
    state.shopPending={kind,phase:'fill',itemId:String(item.id),itemTpl:String(item.tpl??item.templateId??itemTemplateId(el)??''),
      name:String(item.name||item.nick||item.id),before,pack,goalClicks:Math.min(clicks,MAX_BUY_BATCH_ITEMS),
      added:0,prevCount:0,prevSignature:null,lastAt:Date.now()};
    status('Kupuję partiami: '+state.shopPending.goalClicks+' opakowań '+String(item.name||item.id)+'.','ZAKUPY');
  }
  // Przeskanuj torby 1, 1, 2, 2, 3, 3 (jak w teście Tunia-only).
  // Zmieniamy wyłącznie rozpoznaną zakładkę ekwipunku, nigdy przycisk sklepu.
  const SELL_BAG_SEQUENCE=[1,1,2,2,3,3];
  function bagTab(number){
    const visible=el=>!!el?.getClientRects?.().length;
    const win=shopWindow();
    // Zakładki 1/2/3 są widoczne NAD koszykiem Sprzedaj w nowym UI,
    // nie w osobnym panelu zewnętrznego ekwipunku.
    if(win){
      const sellLabel=[...win.querySelectorAll('span,div,label')].find(el=>el.children.length===0&&
        /^(sprzedaj|sprzedaz)$/.test(norm(el.textContent||''))&&visible(el));
      if(sellLabel){
        const sr=sellLabel.getBoundingClientRect();
        const candidates=[...win.querySelectorAll('button,.button,[role="tab"],.tab,.bag-tab,[data-bag],div,span')]
          .filter(el=>visible(el)&&el.children.length===0&&norm(el.textContent||'')===String(number))
          .filter(el=>{const r=el.getBoundingClientRect();return r.top<sr.top&&r.bottom>sr.top-95&&
            Math.abs((r.left+r.right)/2-(sr.left+sr.right)/2)<150&&r.width<80&&r.height<80;});
        if(candidates.length)return candidates.sort((a,b)=>a.getBoundingClientRect().width-b.getBoundingClientRect().width)[0];
      }
    }
    const direct=[`[data-bag="${number}"]`,`[data-bag-id="${number}"]`,
      `.bag-tab[data-index="${number-1}"]`,`#bag${number}`];
    for(const selector of direct){const el=document.querySelector(selector);if(visible(el)&&!win?.contains(el))return el;}
    const roots=[...document.querySelectorAll('.inventory,.inventory-window,.bag-tabs,.bags-tabs,.bags-nav,.inventory-bags,.bags')]
      .filter(el=>visible(el)&&!win?.contains(el));
    for(const root of roots){
      const options=[...root.querySelectorAll('button,[role="tab"],.tab,.bag-tab,[class*="bag-button"]')];
      const btn=options.find(el=>visible(el)&&norm(el.textContent||'')===String(number));
      if(btn)return btn;
    }
    return null;
  }
  function advanceSellBag(now){
    if(!Number.isInteger(state.shopBagIndex))state.shopBagIndex=0;
    if(state.shopBagIndex>=SELL_BAG_SEQUENCE.length)return false;
    const number=SELL_BAG_SEQUENCE[state.shopBagIndex++];
    const tab=bagTab(number);
    if(tab){tab.click();state.shopBagWaitUntil=now+850;status('Przeglądam torbę '+number+' ('+state.shopBagIndex+'/6).','SPRZEDAŻ');}
    else status('Brak widocznej zakładki torby '+number+'; pomijam przebieg.','SPRZEDAŻ');
    return true;
  }
  let shopRecoveryButton=null;
  function showShopRecoveryButton(show){
    if(shopRecoveryButton)shopRecoveryButton.style.display=show?'block':'none';
  }
  function approveStagedCart(){
    if(!licenseActive()){
      status('Najpierw aktywuj licencję.','LICENCJA');return false;
    }
    if(state.shopStep!=='review'||!shopVisible())return false;
    const basket=shopBasketState(),cells=basketItems('sell');
    if(!basket.open||basket.buy!==0||!cells?.length||cells.length!==state.shopReviewCount){
      status('Zawartość koszyka się zmieniła — sprawdź go i uruchom handel ponownie.','SKLEP');
      return false;
    }
    const now=Date.now();
    state.shopPending={kind:'sell-batch',phase:'commit',recovered:true,manualApproved:true,
      ids:cells.map((el,i)=>String(domItemId(el)||'cart-'+i)),beforeAmounts:{},at:now,lastAt:now};
    state.shopStep='trade';showShopRecoveryButton(false);
    status('Potwierdzono koszyk '+cells.length+' przedmiotów — realizuję sprzedaż.','SPRZEDAŻ');
    return true;
  }
  function shopCycle(g,c){
    if(state.shopStep==='error'){status(state.shopError,'SKLEP BŁĄD');return;}
    if(state.shopStep==='review')return;
    if(state.shopStep==='open'){
      if(shopVisible()){state.shopStep='trade';status('Sklep Tunii wykryty — rozpoczynam handel.','SKLEP');return;}
      openTunia(g);return;
    }
    if(!shopVisible()){
      if(state.shopPending)return pauseTrade('Sklep zamknął się podczas transakcji.');
      state.shopStep='open';return;
    }
    if(!c.readable)return pauseTrade('Nie mam wiarygodnego odczytu ekwipunku.');
    if(Date.now()<(state.shopBagWaitUntil||0))return;
    const p=state.shopPending,now=Date.now();
    if(p){
      if(p.kind==='sell-batch')return sellBatchTick(p,c,now);
      return shopBuyTick(p,c,now);
    }
    // Zaległy koszyk — obejmuje też towary odłożone przez v61.5/v61.6,
    // które zniknęły z API plecaka już w chwili zaznaczenia.
    const orphan=shopBasketState();
    if(orphan.sell>0){
      if(orphan.buy!==0)return pauseTrade('Jednocześnie zapełnione oba koszyki. Sprawdź sklep ręcznie.');
      const cells=basketItems('sell');
      if(!cells||cells.length!==orphan.sell)return pauseTrade('Nie mogę odczytać kompletnego koszyka.');
      const safe=cells.every(el=>cartItemIsOrdinary(el,g));
      if(safe){
        state.shopPending={kind:'sell-batch',phase:'commit',recovered:true,
          ids:cells.map((el,i)=>String(domItemId(el)||'cart-'+i)),beforeAmounts:{},at:now,lastAt:now};
        status('Odzyskano '+cells.length+' zwykłych przedmiotów z koszyka — zatwierdzam.','SPRZEDAŻ');
        return;
      }
      // Gdy gra nie udostępnia metadanych, jawne potwierdzenie TEGO
      // koszyka w panelu jest bezpieczniejsze niż zgadywanie rzadkości.
      state.shopStep='review';state.shopReviewCount=cells.length;
      showShopRecoveryButton(true);
      status('Koszyk zawiera '+cells.length+' rzeczy z poprzedniej wersji. Sprawdź je i kliknij w panelu „Zatwierdź ten koszyk”, aby kontynuować zakupy.','SPRZEDAŻ');
      return;
    }
    if(orphan.buy>0)return pauseTrade('Nierozliczone zakupy z poprzedniej wersji. Zatwierdź je ręcznie w sklepie.');
    const ordinary=c.items.filter(x=>!state.shopSellIgnored?.has(String(x.id))&&safeOrdinary(x));
    state.shopOrdinaryIds=ordinary.map(x=>String(x.id));
    if(ordinary.length && ordinary.some(x=>bagItemElement(x))){startSellBatch();return;}
    // Only advance to another bag when the previous cart is truly empty.
    const beforeNextBag=shopBasketState();
    if(beforeNextBag.sell!==0||beforeNextBag.buy!==0)return pauseTrade('Koszyk nie został rozliczony przed zmianą torby.');
    if(advanceSellBag(now))return;
    if(state.supplyPotionGoal>c.potions){
      if(c.bagFull)return pauseTrade('Brak miejsca na mikstury po sprzedaży.');
      const potion=pickPotion(g);
      if(!potion)return pauseTrade('Nie znalazłem w ofercie sklepu: '+SUPPLY.potionName+'. Nie kupuję innej mikstury.');
      const remaining=state.supplyPotionGoal-c.potions;
      const pack=SUPPLY.potionPack;
      // A full pack may exceed the threshold by at most pack-1 units.
      // Exact 150 is not reachable from every starting inventory count.
      if(pack>remaining)status('Brakuje '+remaining+' do 150; ostatni pakiet ma '+pack+'. Kupię pełny pakiet.','ZAKUPY');
      state.supplyChosenPotion={id:String(potion.id),name:potion.name||SUPPLY.potionName,pack};
      preparePurchase('potions',potion,c.potions);return;
    }
    if(!state.supplyScrollPurchased && c.scrolls<SUPPLY.scrollThreshold){
      if(c.bagFull)return pauseTrade('Brak miejsca na pakiet teleportów.');
      const scroll=pickScroll(g);
      if(!scroll)return pauseTrade('Nie rozpoznałem zwoju teleportacji w sklepie. Diagnostyka: MF61.inspectShop().');
      preparePurchase('scrolls',scroll,c.scrolls);return;
    }
    // Zakupy zakończone. Zamknięcie obsługuje osobny etap 'return':
    // dzięki temu nie uznajemy samego click() za zamknięcie sklepu.
    state.supplyPhase='return';state.navDestination=null;state.pendingGate=null;
    state.shopCloseStartedAt=Date.now();state.shopCloseLastAt=0;state.shopCloseAttempts=0;
    state.supplyReturnMap=state.supplyReturnMap||currentMap(g);
    status('Sprzedaż i zakupy zakończone. Zamykam sklep, a potem wracam na '+(EXP[state.supplyReturnExpo]?.name||chosen().name)+'.','POWRÓT');
  }
  function useTuniaTeleport(g,c){
    if(Date.now()-state.teleportAt<12000)return false;
    const item=c.items.find(x=>keyNorm(x.name)===keyNorm(SUPPLY.scrollName));
    if(!item)return false;
    const stats=itemStats(item);if(/gotowy do uzycia za|gotowy do użycia za/i.test(String(stats.tip??'')))return false;
    if(request('moveitem&id='+encodeURIComponent(item.id)+'&st=1')){
      state.teleportAt=Date.now();status('Używam teleportu na Kwieciste Przejście.','TUNIA');return true;
    }
    return false;
  }
  function prepareSupply(c,id){
    state.supplyPotionGoal=c.potions<SUPPLY.potionThreshold?SUPPLY.potionTarget:c.potions;
    state.supplyScrollGoal=c.scrolls<SUPPLY.scrollThreshold&&!state.supplyScrollPurchased?c.scrolls+SUPPLY.scrollPack:c.scrolls;
    state.supplyPhase='to_tunia';state.supplyReturnMap=id;state.supplyReturnExpo=state.selected;
    state.supplyReason=[c.bagFull?'pełny plecak':'',c.potions<SUPPLY.potionThreshold?'mikstury <5':'',c.scrolls<SUPPLY.scrollThreshold&&!state.supplyScrollPurchased?'teleporty <10':''].filter(Boolean).join(', ');
    state.shopStep='open';state.shopPending=null;state.shopError='';state.shopCloseStartedAt=0;state.shopCloseLastAt=0;state.shopCloseAttempts=0;showShopRecoveryButton(false);state.shopBagIndex=0;state.shopBagWaitUntil=0;state.shopSellIgnored=new Set();state.shopSellAccepted=0;state.shopPurchaseCount=0;state.shopTalkAt=0;state.shopTalkAttempts=0;state.shopReplyAt=0;state.shopOpenAt=0;state.dialogStartedAt=0;state.dialogueClickCount=0;state.lastDialogueSignature='';state.lastDialogueClickAt=0;
    state.navDestination=null;state.pendingGate=null;
  }
  function supplyTick(g,id){
    const c=supplyCounts(g),now=Date.now();
    if(state.supplyPhase==='idle'){
      if(!userOptions.autoSupply)return false;
      if(!c.readable){if(now-state.supplyLastAttempt>25000){state.supplyLastAttempt=now;status('Nie odczytuję przedmiotów z plecaka; nie zgaduję zapasów.','EQ');}return false;}
      if(!syncScrollPurchaseLock(g,c.scrolls)){
        if(now-state.supplyLastAttempt>25000){state.supplyLastAttempt=now;status('Czekam na identyfikację postaci, aby zapamiętać blokadę zakupu teleportów.','EQ');}
        return false;
      }
      if(c.freeSlots===null && c.potions>=SUPPLY.potionThreshold &&
         (c.scrolls>=SUPPLY.scrollThreshold||state.supplyScrollPurchased)){
        if(now-state.supplyLastAttempt>25000){
          state.supplyLastAttempt=now;
          status('Nie można ustalić wolnych miejsc w EQ. Otwórz plecak, aby bot odczytał sloty.','EQ');
        }
        return false;
      }
      if(!c.bagFull && c.potions>=SUPPLY.potionThreshold && (c.scrolls>=SUPPLY.scrollThreshold||state.supplyScrollPurchased))return false;
      prepareSupply(c,id);
    }
    if(state.supplyPhase==='to_tunia'){
      if(id===SUPPLY.tuniaMap){state.supplyPhase='shop';state.shopStep='open';state.navDestination=null;}
      else{
        if(id!==SUPPLY.approachMap && useTuniaTeleport(g,c))return true;
        const path=findNearest(id,[SUPPLY.tuniaMap]);
        if(path){state.navDestination=path.id;navigate(g,id,path.id);if(state.running)status('Zaopatrzenie: idę do Tunii ('+state.supplyReason+').','TUNIA');}
        else if(!exploreNavigate(g,id,[SUPPLY.tuniaMap],'TUNIA'))noteNoRoute('Brak potwierdzonej trasy do Tunii. Potrzebuję bramki lub zwoju.');
        return true;
      }
    }
    if(state.supplyPhase==='shop'){
      if(id!==SUPPLY.tuniaMap){state.supplyPhase='to_tunia';return true;}
      shopCycle(g,c);return true;
    }
    if(state.supplyPhase==='return'){
      if(shopVisible()){
        const now=Date.now();
        if(!state.shopCloseStartedAt)state.shopCloseStartedAt=now;
        // Tylko po wykonanych transakcjach i przy pustych koszykach.
        const basket=shopBasketState();
        if(basket.buy!==0||basket.sell!==0){
          return pauseTrade('Nie zamykam sklepu: pozostały nierozliczone przedmioty ('+
            basket.sell+' sprzedaż, '+basket.buy+' kupno).');
        }
        if(now-state.shopCloseStartedAt>12000){
          return pauseTrade('Nie udało się zamknąć okna sklepu w 12 sekund. Sprawdź X sklepu.');
        }
        if(now-(state.shopCloseLastAt||0)>=1100){
          state.shopCloseLastAt=now;
          state.shopCloseAttempts=(state.shopCloseAttempts||0)+1;
          const clicked=closeShop();
          status(clicked?'Klikam X sklepu i sprawdzam zamknięcie ('+state.shopCloseAttempts+').':
            'Szukam przycisku X w ramce sklepu ('+state.shopCloseAttempts+').','POWRÓT');
        }
        return true;
      }
      state.shopCloseStartedAt=0;state.shopCloseLastAt=0;state.shopCloseAttempts=0;
      const expo=EXP[state.supplyReturnExpo]||chosen();
      if(expo.maps.includes(id)){
        state.supplyPhase='idle';state.navDestination=null;state.pendingGate=null;state.supplyReturnExpo=null;status('Powrót na '+expo.name+' zakończony. Wznawiam EXP.','EXP');return false;
      }
      const path=findNearest(id,expo.maps);
      if(path){state.navDestination=path.id;navigate(g,id,path.id);if(state.running)status('Wracam na '+expo.name+'.','POWRÓT');}
      else if(!exploreNavigate(g,id,expo.maps,'POWRÓT'))noteNoRoute('Brak potwierdzonej trasy powrotnej; czekam na nowe bramki.');
      return true;
    }
    return false;
  }

  // Weryfikacji antybotowej nie próbujemy rozwiązywać ani obchodzić.
  // Automat jest wstrzymany do czasu ręcznego zamknięcia okna przez gracza.
  function mfCaptchaTick(){
    const popup=[...document.querySelectorAll('.captcha-window,#captcha,.captcha,[class*="captcha-window"]')]
      .find(el=>el.getClientRects?.().length>0 && getComputedStyle(el).visibility!=='hidden');
    if(!popup)return false;
    if(state.running)status('Weryfikacja w grze: wykonaj ją ręcznie. Automat wstrzymany.','PAUZA');
    return true;
  }

  function tick() {
    if(mfCaptchaTick())return;
    if(!state.running)return;
    const g=getEngineSafe();
    if(!g?.map || !g?.hero){status('Nie znaleziono silnika gry.','OCZEKIWANIE');return;}
    const id=currentMap(g);
    if(!id){status('Mapa się ładuje — czekam na poprawne ID.','ŁADOWANIE');return;}
    if(state.lastMap!==id) {
      if(state.pendingGate?.from===state.lastMap && state.pendingGate?.to===id) {
        addExit(state.lastMap,id,state.pendingGate.x,state.pendingGate.y,{confirmed:true,source:'observed-transition'});
        markTransition(state.lastMap,id);
        markAtlasDirty();
      }
      resetForMap(id);
      status('Mapa: '+(MAP_NAMES[id] || g.map.d.name || id)+'.','MAPA');
    }
    scanLive(g,id);
    if(inBattle(g)){handleBattle(g);return;}
    if(supplyTick(g,id))return;
    if(Date.now()-state.mapEnteredAt<1800){status('Czekam na stabilizację mapy.','ŁADOWANIE');return;}
    const expo=chosen();
    if(!expo.npcs?.length){status('Brak zweryfikowanych nazw NPC dla tego expowiska.','BRAK DANYCH');return;}
    if(expo.maps.includes(id)) {
      // Zawsze preferuj realne potwory przed planowaną podróżą.
      if(state.navDestination && matchingMobs(g,expo).length)state.navDestination=null;
      if(state.navDestination)navigate(g,id,state.navDestination);
      else farm(g,id,expo);
    } else {
      const dest=findNearest(id,expo.maps);
      if(!dest) {
        if(!exploreNavigate(g,id,expo.maps,'DOJŚCIE'))noteNoRoute('Brak znanej trasy do '+expo.name+' i nie ma dostępnych bramek do odkrycia.');
        return;
      }
      state.navDestination=dest.id;
      navigate(g,id,dest.id);
    }
  }
  function noteNoRoute(message){
    if(!state.noRouteSince)state.noRouteSince=Date.now();
    if(Date.now()-state.noRouteSince>150000){
      failStop('Brak możliwej trasy przez ponad 2,5 min. '+message);return;
    }
    status(message,'BRAK TRASY');
  }
  function failStop(message,phase='BŁĄD'){
    state.lastError=String(message);
    state.running=false;
    state.pendingGate=null;state.navDestination=null;
    saveConfig();
    try{getEngineSafe()?.hero?.stopAutoGoTo?.();}catch{}
    status(message,phase);
  }
  function safeTick(){
    if(!state.running)return;
    if(!licenseActive()){
      failStop('Brak ważnej licencji. Wklej lub odnow klucz w panelu.','LICENCJA');
      refreshLicenseDisplay();
      return;
    }
    ++tickSerial;
    try{
      tick();state.consecutiveTickErrors=0;
    }catch(error){
      state.consecutiveTickErrors++;
      state.lastError=String(error?.stack||error);
      console.error('[MF61] Błąd sterownika:',error);
      if(state.consecutiveTickErrors>=MAX_CONSECUTIVE_TICK_ERRORS){
        failStop('Pięć kolejnych błędów sterownika. Automatyzacja zatrzymana. Sprawdź MF61.debug().');
      }else{
        status('Błąd sterownika '+state.consecutiveTickErrors+'/'+MAX_CONSECUTIVE_TICK_ERRORS+': '+String(error?.message||error),'BŁĄD');
      }
    }
  }
  function start(){
    if(!licenseActive()){
      status('Wymagana aktywna licencja AtlasFarm PRO.','LICENCJA');
      refreshLicenseDisplay();
      return false;
    }
    if(state.running)return true;
    state.running=true;state.consecutiveTickErrors=0;state.lastError=null;
    state.lastMap=null;state.noMobSince=Date.now();state.navDestination=null;state.expoVisits={};
    state.pendingGate=null;state.lastAction=0;state.supplyPhase='idle';state.exploreSteps=0;
    state.noRouteSince=0;
    saveConfig();
    status('START — '+chosen().lvl+' lvl: '+chosen().name+'.','START');
    safeTick();
    return true;
  }
  function stop({preserveRunning=false}={}){
    state.running=false;state.pendingGate=null;state.navDestination=null;state.supplyPhase='idle';
    if(!preserveRunning)saveConfig();
    try{getEngineSafe()?.hero?.stopAutoGoTo?.();}catch{}
    try{getEngineSafe()?.battle?.autoFightCancel?.();}catch{}
    status('Zatrzymano podróż, walkę i handel.','STOP');
  }
  function select(index){
    const i=Number(index);
    if(!Number.isInteger(i)||!EXP[i])return;
    if(state.supplyPhase==='shop' && state.shopPending){
      status('Zmień expowisko dopiero po zakończeniu transakcji albo zatrzymaj automat.','SKLEP');return;
    }
    state.selected=i;state.navDestination=null;state.pendingGate=null;
    state.lastMap=null;state.lastAction=0;state.lastTargetId=null;state.supplyPhase='idle';
    if(state.running)try{getEngineSafe()?.hero?.stopAutoGoTo?.();}catch{}
    saveConfig();
    status('Wybrano '+EXP[i].name+' '+EXP[i].lvl+' lvl'+(state.running?' — zmieniam expowisko.':'.'),state.running?'START':'STOP');
    if(state.running)safeTick();
  }
  function setOption(key,value){
    if(!Object.hasOwn(userOptions,key))return false;
    if(key==='autoSupply' && value===false && state.supplyPhase!=='idle'){
      // Możliwy koszyk w trakcie kompletowania: nie zmieniaj trybu w locie.
      stop();
      state.shopPending=null;
    }
    userOptions[key]=!!value;saveConfig();
    status('Ustawienie '+key+': '+(userOptions[key]?'włączone':'wyłączone')+'.',state.running?'START':'STOP');
    return true;
  }
  function debug() {
    ++tickSerial;const g=getEngineSafe(),id=currentMap(g),expo=chosen();
    const list=getCharacters(g);
    const report={supply:{phase:state.supplyPhase,reason:state.supplyReason,counts:supplyCounts(g),settings:SUPPLY,scrollPurchaseLocked:state.supplyScrollPurchased,scrollCharacter:scrollCharacterKey(g)},version:VERSION,running:state.running,mapId:id,mapName:g?.map?.d?.name,expo:expo.name,expoLevel:expo.lvl,
      validMaps:expo.maps,knownNpcNames:expo.npcs,matched:matchingMobs(g,expo).map(m=>({id:m.id,name:m.d.nick||m.d.name,lvl:m.d.lvl,x:m.d.x,y:m.d.y})),
      visibleLeveled:list.filter(c=>Number(c.d.lvl??c.d.level)>0).map(c=>({id:c.id,name:c.d.nick??c.d.name,lvl:c.d.lvl??c.d.level,type:c.d.type})).slice(0,60),
      inventorySources:{snapshot:inventorySnapshot(g),fetchLocationItemsType:typeof g?.items?.fetchLocationItems,engineKeys:Object.keys(g||{}).filter(k=>/item|eq|inventory|bag/i.test(k)),itemKeys:Object.keys(g?.item||{}).slice(0,35),itemsKeys:Object.keys(g?.items||{}).slice(0,35),inventoryKeys:Object.keys(g?.inventory||{}).slice(0,35)},
      liveGates:getGates(g).map(gw=>({name:gateLabel(gw),target:gateTarget(gw),coords:gateCoords(gw),available:gw?.available})),
      basket:shopBasketState(),exits:atlas.maps[id]?.exits || [],route:findNearest(id,expo.maps),state:{phase:state.phase,message:state.message,shopStep:state.shopStep,shopError:state.shopError,shopPending:state.shopPending,exploreSteps:state.exploreSteps,lastError:state.lastError,consecutiveTickErrors:state.consecutiveTickErrors}};
    console.log('[MF61] STATUS DEBUG',report);return report;
  }
  function inspectShop(){
    ++tickSerial;const g=getEngineSafe();
    const keys=o=>o&&typeof o==='object'?Object.keys(o).slice(0,80):[];
    const report={map:currentMap(g),inventory:inventorySnapshot(g),shopVisible:shopVisible(),shopWindowFound:!!shopWindow(),basket:shopBasketState(),shopHtmlExcerpt:'[ukryto dla prywatności]',shopStockIds:[...shopWindow()?.querySelectorAll('.shop-items [class*=item-id-]')||[]].map(domItemId).slice(0,60),merchantItems:rawShopItems(g),preferredPotion:pickPotion(g),preferredScroll:pickScroll(g),
      sellCandidates:inventorySnapshot(g).items.filter(safeOrdinary).map(x=>({id:x.id,name:x.name,rarity:x.rarity??x.quality??x.rank,loc:x.loc})),
      merchantCandidates:keys(g).filter(k=>/shop|merchant|npc|dialog|trade|item/i.test(k)),
      engineShopKeys:keys(g?.shop),engineMerchantKeys:keys(g?.merchant),
      engineDialogKeys:keys(g?.dialogue??g?.dialog),engineItemKeys:keys(g?.items),
      basketState:shopBasketState(),
      basketBuyIds:basketItems('buy')?.map(domItemId)??null,
      basketSellIds:basketItems('sell')?.map(domItemId)??null,
      basketSellOrdinary:basketItems('sell')?.map(el=>cartItemIsOrdinary(el,g))??null,
      confirmButtonType:shopAcceptButton()?.tagName||null,
      sellProgress:{...tradeBagStatus(),accepted:state.shopSellAccepted||0,ignoredIds:[...(state.shopSellIgnored||[])]},balanceStatus:shopBalanceStatus(),
      shopHeaders:[...shopWindow()?.querySelectorAll('div,span,h2,h3,h4')||[]]
        .filter(el=>el.children.length===0&&/kup|sprzed|zakup/i.test(el.textContent||''))
        .slice(0,20).map(el=>({text:el.textContent?.trim(),cls:String(el.className).slice(0,90)})),
      uiCandidates:[...document.querySelectorAll('[class*=shop],[id*=shop],[class*=merchant],[id*=merchant]')].slice(0,20).map(el=>({tag:el.tagName,id:el.id,className:String(el.className).slice(0,120)})),
      blockedSellCandidates:inventorySnapshot(g).items.filter(x=>{const el=bagItemElement(x);return el&&/(?:^|\s)(?:SHOP-disable|disable-item-mark)(?:\s|$)/i.test(String(el.className))}).map(x=>({id:x.id,name:x.name,cls:String(bagItemElement(x)?.className).slice(0,140)})).slice(0,30),
      inventoryDomExample:[...document.querySelectorAll('.inventory-item')].slice(0,5).map(el=>({id:domItemId(el),cls:String(el.className).slice(0,140),type:el.getAttribute?.('data-item-type')}))};
    console.log('[MF61] SKLEP: diagnostyka bez transakcji',report);return report;
  }
  function exportAtlas(){flushAtlas();return JSON.stringify(atlas,null,2);}
  function downloadAtlas(){
    const blob=new Blob([exportAtlas()],{type:'application/json;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');link.href=url;link.download='margonem-atlas-mf61.json';
      document.body.appendChild(link);link.click();link.remove();
    }finally{setTimeout(()=>URL.revokeObjectURL(url),5000);}
  }
  function importAtlas(json){
    const value=typeof json==='string'?JSON.parse(json):json;
    if(!value||typeof value!=='object'||!value.maps||typeof value.maps!=='object')throw Error('Niepoprawny format atlasu.');
    if(Object.keys(value.maps).length>10000)throw Error('Przekroczono limit 10 000 map.');
    let imported=0,totalExits=0;
    for(const [from,map] of Object.entries(value.maps)){
      if(!goodId(from)||!map||typeof map!=='object')continue;
      const exits=Array.isArray(map.exits)?map.exits.slice(0,250):[];
      ensureMap(from,String(map.name||'').slice(0,120));
      for(const e of exits){
        if(++totalExits>30000)throw Error('Atlas przekracza limit 30 000 przejść.');
        if(!e||typeof e!=='object')continue;
        if(addExit(from,e.to,e.x,e.y,{confirmed:e.confirmed===true,
          source:'imported',name:String(e.name||'').slice(0,100)}))imported++;
      }
    }
    flushAtlas();status('Zaimportowano '+imported+' nowych połączeń.','ATLAS');return imported;
  }
  function destroy({preserveRunning=false}={}){
    ++license.requestId;
    stop({preserveRunning});
    if(loop!==null)clearInterval(loop);loop=null;
    if(typeof ROOT.removeEventListener==='function')ROOT.removeEventListener('pagehide',flushAtlas);
    flushAtlas();panel?.remove();panel=null;
    for(const name of ['MF61','MF56','MF54'])if(ROOT[name]===api)delete ROOT[name];
  }
  const api={version:VERSION,productVersion:PRODUCT_VERSION,product:PRODUCT_NAME,start,stop,select,debug,inspectShop,exportAtlas,downloadAtlas,importAtlas,resetBlockedRoutes,setOption,destroy,state,options:userOptions,catalog:EXP,supplySettings:SUPPLY,
    getLicenseStatus:()=>({checked:license.checked,active:licenseActive(),licenseId:license.details?.licenseId||null,expiresAt:license.details?.expiresAt||null,message:license.message}),
    activateLicense,removeLicense,
    approveStagedCart, tickNow:safeTick,previewTrade:()=>{const g=getEngineSafe(),c=supplyCounts(g);return {ordinary:c.items.filter(safeOrdinary).map(x=>({id:x.id,name:x.name})),shopItems:rawShopItems(g).map(x=>({id:x.id,name:x.name,price:x.price,loc:x.loc})),potion:pickPotion(g),scroll:pickScroll(g),counts:c};},
    listGateways:()=>getGates(getEngineSafe()).map(gw=>({name:gateLabel(gw),to:gateTarget(gw),...gateCoords(gw),available:gw?.available})),
    getRoute:(to)=>{const id=currentMap(getEngineSafe());return id && goodId(to) ? allPaths(id).get(String(to))||null:null;},
    addVerifiedGate:(from,to,x,y)=>addExit(from,to,x,y,{confirmed:true,source:'manual-verified'})
  };

  // Jeden panel, jedna pętla. Stare skrypty można wyłączyć przez odświeżenie strony.
  // Stare instancje wyłączono już przed pobraniem konfiguracji.
  try{ROOT.MF52?.destroy?.();ROOT.MF51?.destroy?.();ROOT.MF50?.destroy?.();ROOT.MF49?.destroy?.();ROOT.MF48?.destroy?.();}catch{}
  ROOT.MF61=api;ROOT.MF56=api;ROOT.MF54=api;
  if(typeof document!=='undefined' && document.body){
    panel=document.createElement('section');panel.id='mf61-panel';
    panel.setAttribute('aria-label',PRODUCT_NAME+' '+PRODUCT_VERSION);
    panel.style.cssText='position:fixed;z-index:2147483600;top:80px;left:12px;width:330px;max-width:calc(100vw - 24px);box-sizing:border-box;background:#14202c;color:#f2f5fa;font:12px system-ui,Arial,sans-serif;border:1px solid #526b82;border-radius:12px;box-shadow:0 5px 26px #0009;overflow:hidden';
    const header=document.createElement('div');header.style.cssText='padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:6px;background:#203247;cursor:move;user-select:none';
    const title=document.createElement('strong');title.textContent='⚔ '+PRODUCT_NAME+' '+PRODUCT_VERSION;title.style.cssText='font-size:15px';
    const collapse=document.createElement('button');collapse.type='button';collapse.textContent='−';collapse.title='Zwiń/rozwiń';
    collapse.style.cssText='background:#344e67;color:white;border:0;border-radius:5px;min-width:25px;cursor:pointer';
    header.append(title,collapse);
    const body=document.createElement('div');body.style.cssText='padding:10px 12px 12px';
    const search=document.createElement('input');search.placeholder='Szukaj expowiska...';search.setAttribute('aria-label','Szukaj expowiska');
    search.style.cssText='width:100%;box-sizing:border-box;background:#0b1623;color:white;border:1px solid #57718c;border-radius:6px;padding:8px;margin-bottom:6px';
    selectEl=document.createElement('select');selectEl.setAttribute('aria-label','Wybierz expowisko');
    selectEl.style.cssText='width:100%;box-sizing:border-box;background:#0b1623;color:white;border:1px solid #57718c;border-radius:6px;padding:8px;margin-bottom:8px';
    function fill(q=''){
      const old=state.selected;selectEl.replaceChildren();
      EXP.forEach((e,i)=>{
        const label=e.lvl+' lvl — '+e.name+' ('+e.maps.length+' map, '+e.npcs.length+' NPC)';
        if(!norm(label).includes(norm(q)))return;
        const option=document.createElement('option');option.value=String(i);option.textContent=label;
        selectEl.appendChild(option);
      });
      if([...selectEl.options].some(o=>Number(o.value)===old))selectEl.value=String(old);
      else selectEl.selectedIndex=-1;
    }
    fill();search.addEventListener('input',()=>fill(search.value));
    selectEl.addEventListener('change',()=>select(selectEl.value));
    const controls=document.createElement('div');controls.style.cssText='display:flex;gap:8px';
    const mkButton=(label,bg,cb)=>{
      const b=document.createElement('button');b.type='button';b.textContent=label;
      b.style.cssText='flex:1;background:'+bg+';color:white;padding:9px;border:0;border-radius:6px;cursor:pointer;font-weight:700';
      b.addEventListener('click',cb);return b;
    };
    const go=mkButton('▶ START','#178146',start),halt=mkButton('■ STOP','#b12b3e',()=>stop());
    licenseStartButton=go;
    go.disabled=true;go.style.opacity='.55';
    controls.append(go,halt);
    const recovery=mkButton('Zatwierdź ten koszyk i kup mikstury','#6b5422',approveStagedCart);
    recovery.style.cssText+=';display:block;width:100%;margin:8px 0;line-height:1.4';
    recovery.style.display='none';shopRecoveryButton=recovery;

    statusEl=document.createElement('div');statusEl.setAttribute('role','status');statusEl.textContent='STOP · Gotowy';
    statusEl.style.cssText='margin:9px 0;overflow-wrap:anywhere;line-height:1.45;color:#b9d9f3';
    const settings=document.createElement('div');settings.style.cssText='display:flex;flex-wrap:wrap;gap:6px 10px;margin:7px 0';
    for(const [key,text] of [['autoSupply','Automatyczny handel'],['autoExplore','Odkrywanie tras'],['autoFight','Automatyczna walka']]){
      const lbl=document.createElement('label');lbl.style.cssText='display:inline-flex;align-items:center;gap:4px;cursor:pointer';
      const chk=document.createElement('input');chk.type='checkbox';chk.checked=userOptions[key];
      chk.addEventListener('change',()=>setOption(key,chk.checked));lbl.append(chk,document.createTextNode(text));settings.appendChild(lbl);
    }
    const tools=document.createElement('div');tools.style.cssText='display:flex;gap:5px;flex-wrap:wrap;margin-top:8px';
    for(const [name,handler] of [['Diagnostyka',debug],['Eksport atlasu',downloadAtlas],['Odblokuj trasy',resetBlockedRoutes]]){
      const b=mkButton(name,'#345270',handler);b.style.cssText+=';font-size:11px;padding:6px;flex:1 1 auto';tools.appendChild(b);
    }
    const file=document.createElement('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
    file.addEventListener('change',async()=>{
      const selected=file.files?.[0];if(!selected)return;
      try{
        if(selected.size>2000000)throw Error('Plik jest za duży (maks. 2 MB).');
        importAtlas(await selected.text());
      }catch(error){status('Import atlasu: '+String(error?.message||error),'BŁĄD');}
      finally{file.value='';}
    });
    const importButton=mkButton('Import atlasu','#345270',()=>file.click());
    importButton.style.cssText+=';font-size:11px;padding:6px;flex:1 1 auto';tools.append(importButton,file);
    const note=document.createElement('div');note.textContent='Produkt nieoficjalny. Automatyzacja może naruszać regulamin Margonem i skutkować blokadą konta. Weryfikację w grze trzeba rozwiązać ręcznie. Bez leczenia; atlas niekompletny.';
    note.style.cssText='color:#d2c396;font-size:11px;line-height:1.35;margin-top:8px';
    logEl=document.createElement('div');logEl.style.cssText='max-height:104px;overflow:auto;overflow-wrap:anywhere;margin-top:8px;font-size:10px;color:#b3c5d7';
    // Klucz licencyjny można wkleić w panelu bez odwiedzania zewnętrznych stron.
    const licenseBox=document.createElement('div');
    licenseBox.style.cssText='border:1px solid #50687f;border-radius:8px;padding:9px;margin-bottom:10px;background:#101b26';
    const licenseTitle=document.createElement('strong');
    licenseTitle.textContent='Licencja AtlasFarm PRO';
    licenseTitle.style.cssText='display:block;margin-bottom:5px;font-size:12px';
    licenseStatusEl=document.createElement('div');
    licenseStatusEl.style.cssText='font-size:11px;line-height:1.4;margin-bottom:7px;overflow-wrap:anywhere';
    licenseInputEl=document.createElement('textarea');
    licenseInputEl.rows=2;
    licenseInputEl.placeholder='Wklej klucz AFPRO1.... od sprzedawcy';
    licenseInputEl.setAttribute('aria-label','Klucz licencyjny AtlasFarm PRO');
    licenseInputEl.style.cssText='resize:vertical;box-sizing:border-box;width:100%;background:#0b1623;color:white;border:1px solid #57718c;border-radius:5px;padding:6px;font:11px monospace';
    const licenseActions=document.createElement('div');
    licenseActions.style.cssText='display:flex;gap:7px;margin-top:6px';
    const activateButton=mkButton('Aktywuj klucz','#286c8e',async()=>{
      activateButton.disabled=true;
      try{await activateLicense(licenseInputEl.value,true);}
      finally{licenseInputEl.value='';refreshLicenseDisplay();}
    });
    activateButton.style.cssText+=';padding:6px';
    licenseActivateButton=activateButton;
    const deleteButton=mkButton('Usuń licencję','#634354',()=>{
      if(window.confirm('Usunąć zapisany klucz? Aby ponownie aktywować, potrzebny będzie ten sam klucz.'))removeLicense();
    });
    deleteButton.style.cssText+=';padding:6px';
    licenseActions.append(activateButton,deleteButton);
    licenseBox.append(licenseTitle,licenseStatusEl,licenseInputEl,licenseActions);
    refreshLicenseDisplay();
    body.append(licenseBox,search,selectEl,controls,recovery,statusEl,settings,tools,note,logEl);
    collapse.addEventListener('click',()=>{body.hidden=!body.hidden;collapse.textContent=body.hidden?'+':'−';});
    // Własne przeciąganie bez zewnętrznych bibliotek i globalnych handlerów.
    let drag=null;
    header.addEventListener('pointerdown',e=>{
      if(e.target===collapse||e.button!==0)return;
      drag={x:e.clientX,y:e.clientY,left:panel.offsetLeft,top:panel.offsetTop};
      try{header.setPointerCapture(e.pointerId);}catch{}
    });
    header.addEventListener('pointermove',e=>{
      if(!drag)return;
      const left=Math.min(Math.max(0,drag.left+e.clientX-drag.x),Math.max(0,window.innerWidth-panel.offsetWidth));
      const top=Math.min(Math.max(0,drag.top+e.clientY-drag.y),Math.max(0,window.innerHeight-35));
      panel.style.left=left+'px';panel.style.top=top+'px';
    });
    const endDrag=()=>{drag=null;};header.addEventListener('pointerup',endDrag);header.addEventListener('pointercancel',endDrag);
    panel.append(header,body);document.body.appendChild(panel);
  }
  loop=setInterval(safeTick,TICK_MS);
  if(typeof ROOT.addEventListener==='function')ROOT.addEventListener('pagehide',flushAtlas);
  // Każde uruchomienie wymaga poprawnej weryfikacji podpisu przed wznowieniem sesji.
  initLicense().catch(error=>{
    license.checked=true;license.valid=false;license.message=String(error?.message||error);
    refreshLicenseDisplay();status('Błąd inicjalizacji licencji.','LICENCJA');
  });
  console.info('[MF61] Załadowano',EXP.length,'expowisk; zaimportowano',imported,
    'połączeń; atlas',Object.keys(atlas.maps).length,'map. Diagnostyka: MF61.debug()');
})();
