/**
 * 單字庫：依難度分級
 * word    英文單字（答案，全小寫）
 * zh      中文意思
 * ipa     音標
 * hint    例句（單字以 ___ 取代）
 */
const WORD_BANK = {
  easy: [
    { word: 'apple',  zh: '蘋果',     ipa: '/ˈæp.əl/',    hint: 'She ate a red ___ for lunch.' },
    { word: 'water',  zh: '水',       ipa: '/ˈwɔː.tər/',  hint: 'Please drink more ___ every day.' },
    { word: 'house',  zh: '房子',     ipa: '/haʊs/',      hint: 'They live in a small ___ near the sea.' },
    { word: 'music',  zh: '音樂',     ipa: '/ˈmjuː.zɪk/', hint: 'He listens to ___ while running.' },
    { word: 'happy',  zh: '快樂的',   ipa: '/ˈhæp.i/',    hint: 'I feel very ___ today.' },
    { word: 'green',  zh: '綠色的',   ipa: '/ɡriːn/',     hint: 'The leaves turn ___ in spring.' },
    { word: 'table',  zh: '桌子',     ipa: '/ˈteɪ.bəl/',  hint: 'Put the cups on the ___.' },
    { word: 'light',  zh: '光；燈',   ipa: '/laɪt/',      hint: 'Turn off the ___ before you sleep.' },
    { word: 'bread',  zh: '麵包',     ipa: '/bred/',      hint: 'We bought fresh ___ this morning.' },
    { word: 'smile',  zh: '微笑',     ipa: '/smaɪl/',     hint: 'Her ___ makes everyone warm.' },
    { word: 'cloud',  zh: '雲',       ipa: '/klaʊd/',     hint: 'A white ___ floated across the sky.' },
    { word: 'river',  zh: '河流',     ipa: '/ˈrɪv.ər/',   hint: 'The ___ runs through the town.' },
    { word: 'dream',  zh: '夢想',     ipa: '/driːm/',     hint: 'Never give up on your ___.' },
    { word: 'plant',  zh: '植物',     ipa: '/plænt/',     hint: 'This ___ needs a lot of sunlight.' },
    { word: 'sugar',  zh: '糖',       ipa: '/ˈʃʊɡ.ər/',   hint: 'He adds ___ to his coffee.' }
  ],
  normal: [
    { word: 'garden', zh: '花園',     ipa: '/ˈɡɑːr.dən/',  hint: 'Grandma grows roses in her ___.' },
    { word: 'orange', zh: '柳橙',     ipa: '/ˈɔːr.ɪndʒ/',  hint: 'I drink ___ juice for breakfast.' },
    { word: 'window', zh: '窗戶',     ipa: '/ˈwɪn.doʊ/',   hint: 'Please open the ___ for fresh air.' },
    { word: 'planet', zh: '行星',     ipa: '/ˈplæn.ɪt/',   hint: 'Mars is the fourth ___ from the sun.' },
    { word: 'silver', zh: '銀色的',   ipa: '/ˈsɪl.vər/',   hint: 'She wore a ___ ring.' },
    { word: 'forest', zh: '森林',     ipa: '/ˈfɔːr.ɪst/',  hint: 'Many animals live in the ___.' },
    { word: 'bridge', zh: '橋',       ipa: '/brɪdʒ/',      hint: 'We walked across the old ___.' },
    { word: 'castle', zh: '城堡',     ipa: '/ˈkæs.əl/',    hint: 'The king lived in a stone ___.' },
    { word: 'doctor', zh: '醫生',     ipa: '/ˈdɑːk.tər/',  hint: 'You should see a ___ about that cough.' },
    { word: 'market', zh: '市場',     ipa: '/ˈmɑːr.kɪt/',  hint: 'We buy vegetables at the ___.' },
    { word: 'purple', zh: '紫色的',   ipa: '/ˈpɜːr.pəl/',  hint: 'The sky turned ___ at sunset.' },
    { word: 'animal', zh: '動物',     ipa: '/ˈæn.ɪ.məl/',  hint: 'A dog is a friendly ___.' },
    { word: 'summer', zh: '夏天',     ipa: '/ˈsʌm.ər/',    hint: 'We go swimming every ___.' },
    { word: 'winter', zh: '冬天',     ipa: '/ˈwɪn.tər/',   hint: 'It snows a lot in ___.' },
    { word: 'camera', zh: '相機',     ipa: '/ˈkæm.rə/',    hint: 'He took photos with a new ___.' }
  ],
  hard: [
    { word: 'elephant',  zh: '大象',     ipa: '/ˈel.ɪ.fənt/',    hint: 'An ___ never forgets.' },
    { word: 'mountain',  zh: '山',       ipa: '/ˈmaʊn.tən/',     hint: 'They climbed the highest ___.' },
    { word: 'hospital',  zh: '醫院',     ipa: '/ˈhɑːs.pɪ.təl/',  hint: 'She works as a nurse in a ___.' },
    { word: 'computer',  zh: '電腦',     ipa: '/kəmˈpjuː.tər/',  hint: 'My ___ crashed during the meeting.' },
    { word: 'birthday',  zh: '生日',     ipa: '/ˈbɜːrθ.deɪ/',    hint: 'Happy ___ to you!' },
    { word: 'umbrella',  zh: '雨傘',     ipa: '/ʌmˈbrel.ə/',     hint: 'Take an ___ — it may rain.' },
    { word: 'dinosaur',  zh: '恐龍',     ipa: '/ˈdaɪ.nə.sɔːr/',  hint: 'The museum has a huge ___ bone.' },
    { word: 'adventure', zh: '冒險',     ipa: '/ədˈven.tʃər/',   hint: 'Their trip turned into a great ___.' },
    { word: 'chocolate', zh: '巧克力',   ipa: '/ˈtʃɑːk.lət/',    hint: 'I love dark ___ cake.' },
    { word: 'butterfly', zh: '蝴蝶',     ipa: '/ˈbʌt.ər.flaɪ/',  hint: 'A yellow ___ landed on the flower.' },
    { word: 'knowledge', zh: '知識',     ipa: '/ˈnɑː.lɪdʒ/',     hint: '___ is power.' },
    { word: 'telephone', zh: '電話',     ipa: '/ˈtel.ɪ.foʊn/',   hint: 'The ___ rang three times.' },
    { word: 'vegetable', zh: '蔬菜',     ipa: '/ˈvedʒ.tə.bəl/',  hint: 'Eat one ___ with every meal.' },
    { word: 'wonderful', zh: '極好的',   ipa: '/ˈwʌn.dər.fəl/',  hint: 'We had a ___ time at the beach.' },
    { word: 'dangerous', zh: '危險的',   ipa: '/ˈdeɪn.dʒər.əs/', hint: 'Swimming here is ___.' }
  ]
};

const DIFFICULTY_META = {
  easy:   { label: '簡單', rounds: 5, lives: 6, desc: '4–5 字母・給例句提示' },
  normal: { label: '中等', rounds: 5, lives: 6, desc: '6 字母・提示要付出代價' },
  hard:   { label: '困難', rounds: 5, lives: 6, desc: '8–9 字母・不給例句' }
};
