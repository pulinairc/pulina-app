// Pulina's name, links and icons over Lobby's; the look is brand.css.
export const BRAND = {
  name: 'Pulina',
  quitName: 'pulina-app',
  fiQuitName: 'pulina-appia',
  // The #pulina logo as the channel's picture; anyone can pick another.
  channels: { '#pulina': { photo: 'icons/pulina-channel.png' } },
  // The name for "Tervetuloa …" in Finnish.
  fiInto: 'Pulinaan',
  site: 'https://github.com/pulinairc/pulina-app',
  // Finnish until another language is picked in Settings.
  lang: 'fi',
  // Only #pulina: the welcome asks the nick and nothing else. The network shows as Pulina.
  start: { network: 'Pulina', host: 'irc.quakenet.org', channels: '#pulina', only: true },
  // Own accounts on chat.pulina.fi: an always-on connection that shows as nick!account@pulina.fi.
  accounts: { host: 'pulina.fi', title: 'Liity pulinalaiseksi', lead: 'Pulina-tunnuksia ja shellejä myönnetään kanavan vakiokasvoille.' },
  welcome: 'Welcome to IRC chat',
  startNote: 'The #pulina history is kept in the background.',
  // #pulina's rules from https://www.pulina.fi/saannot/, shown in the welcome before joining.
  rules: {
    title: 'Pulinan säännöt',
    intro: 'Jotta kanava olisi kaikille viihtyisä ja turvallinen, jokaisen tulee noudattaa näitä sääntöjä.',
    link: 'https://www.pulina.fi/saannot/',
    items: [
      { title: 'Hyväksyt, että logit ovat julkisia.', body: 'Kanavalla keskustelut näkyvät nettiin. Jos tämä ei kelpaa, netissä on muitakin keskusteluryhmiä saatavilla.' },
      { title: 'Ei laittomuuksia.', body: 'Noudatamme myös yhdenvertaisuuslakia.' },
      { title: 'Finnish only.', body: 'Vain suomea. #antisocial @ irc.zoite.net is a good active channel in English.' },
      { title: 'Älä soita suutasi opeille.', body: 'Pulina ei ole demokratia ja kanavan operaattorit (käyttäjät, joilla on @-merkki nimimerkin edessä) ovat valtuutettuja tekemään itsenäisiä ja mielivaltaisia päätöksiä. Jos #pulina, sen operaattorit, säännöt tai ihmiset eivät miellytä, suosittelemme etsimään toisen IRC-kanavan tai muun alustan, niitä on netti pullollaan.' },
      { title: 'Noudata IRC-etikettiä.', body: 'Pulinalla käytössä IRCin perussäännöt, kuten älä floodaa tai peeloile.' },
      { title: 'Noudata yleisiä käyttäytymissääntöjä.', body: 'Ole ystävällinen, jos suinkin mahdollista. Ollaan ihmisiä ihmisille, ongelmineen.' },
      { title: 'Älä ärsytä ja provosoi tahallasi.', body: 'Kaikkia ei tietenkään voi miellyttää, vahvat mielipiteet ovat OK, kunhan keskustelu on asiallista. Järkeä saa käyttää. Käyttäydy niin kuin livenäkin voisit kuvitella käyttäytyväsi kasvotusten kaverin kanssa.' },
      { title: 'Älä jaa ikävää sisältöä, pornoa tai muita haitallisia trappilinkkejä, eli linkkejä, joista ei voi arvata mitä linkin takaa paljastuu.', body: 'NSFW (Not Safe For Work) -varoitus annettava etukäteen, jos linkki on sillä rajalla.' },
      { title: 'Älä trollaa tai peeloile.', body: 'Jos tätä on pakko harrastaa, tee se edes hyvin, eli niin, että kaikilla on hauskaa.' },
      { title: 'Älä höykytä bottia, eli suolla komentoja jatkuvalla syötöllä.', body: 'Koskee myös -ei-komennollisia toimintoja, kuten tekoälyvastauksia. Muuta keskustelua on hankala seurata, jos sinulla ja botilla on kahdestaan oma juttu. Privoihin kannattaa hommata oma Claude tai ChatGPT. Scriptkiddieily kielletty, eli turha yrittää kaivaa botista bugeja komentojen kautta. Koodin pitäisi olla toimivaa, mutta jos löydät bugeja, paikkaile niitä botin kaatamisen sijaan GitHubissa.' },
      { title: 'Älä sekoile, ellei se ole osa vitsiä.', body: 'Pidä jutut selkeinä ja terveinä, jos mahdollista. Jos jätit lääkkeesi ottamatta tai vedit liikaa viinaa tai huumeita, älä floodaa kanavaa täyteen huuruisia hajatelmiasi, joista kukaan ei ota tolkkua. Oudot ja sekavat jutut saattavat hämmentää, ahdistaa ja ärsyttää. Koitetaan välttää överiksi meneviä juttuja liittyen esimerkiksi vahvoihin päihteisiin, väkivaltaan, mielenterveysongelmiin ja terveen ihmisen mieltä järkyttäviin asioihin. Pulina on avoin keskustelukanava, mutta ei mikään psykoterapiaohjelma. Asioista saa ja pitää puhua, mutta mielellään selvin päin ja niin että keskustelu kulkee molempiin suuntiin. Jos tarvitset jutusteluapua, tsekkaa esim. Päihdelinkki: Mistä apua? ja Mieli.fi chat.' },
      { title: 'Nollatoleranssi huumausaineille.', body: 'Jätä päihdekeskustelut (lähinnä laittomien huumausaineiden käytöstä puhuminen ja päihteiden glorifiointi) muualle, hyvä paikka näihin on esim. Päihdelinkki.fi. Bannivasaraa seuraa, jos avaudut huumekokeiluistasi. Päihdepoliittinen keskustelu on tietyissä rajoissa OK.' },
      { title: 'Älä loukkaa tahallasi muita ihmisiä tai mene henkilökohtaisuuksiin.', body: 'Jos lunta on tullut tupaan kohdallasi, olet todennäköisesti rikkonut jotain edellä mainittua sääntöä. Operaattoreilla on oikeus käyttää mielivaltaisuuttaan, jos keskustelu menee kohtuuttomiin.' },
      { title: 'Noudata turvallisemman tilan periaatteita.', body: 'Älä oleta, älä syrji, vältä äärimmäistä käytöstä ja ääri-ilmiöitä. Tykkäätkö kuittailla ja perseillä huviksesi? Ei kuulu tälle kanavalle.' },
      { title: 'Ei rasismia, kansallissosialismia tai vihapuhetta.', body: 'Vihapuheella tarkoitetaan viestintää, joka lietsoo vihaa yhtä ihmistä tai ihmisryhmää vastaan (ks. yhdenvertaisuusvaltuutettu.fi)' },
      { title: 'Yksi nick riittää.', body: 'Älä vaihda nimimerkkejä koko ajan, yritä päättää joku yksi tietty, jolla sinut tunnetaan. Jos nimimerkki on jo käytössä tai verkko heittää alt-nickin käyttöön esimerkiksi alaviivalla, se ei haittaa.' },
      { title: 'Jos tulet bannatuksi, ulina ei auta.', body: 'Älä privaa tai kitise, että banni ei ollut oikeutettu. Jos olet saanut bannit, sille on syynsä. Älä liity kanavalle uudestaan eri nimimerkillä tai VPN:n voimin jatkaen samaa sekoilua. Usko kerrasta.' },
      { title: 'Ei toisten yksityisten tietojen levittämistä, doxxaamista tai sheimaamista.', body: '' },
      { title: 'Nollatoleranssi ahdistelulle, seksuaaliselle häirinnälle, h*orittelulle ym. epäsopivalle.', body: 'Muista, että kaikenlainen suostumukseton vihjailu, flirttailu tai ehdottelu on laitonta.' },
      { title: 'Laittomuuksista rikosilmoitus poliisille.', body: '' },
      { title: 'Oikeudet muutoksiin pidätetään.', body: '' },
    ],
  },
  icons: [
    ['pulina-neon', 'Pulina neon'],
    ['terminal', 'Terminal'],
    ['pendant-lamp', 'Pendant lamp'],
    ['chatter', 'Chatter'],
  ],
};
