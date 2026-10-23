/* Built-in vocabulary extracted and adapted from the supplied Smart AI Domain Generator. */
/* ==========================================================================
   CURATED ENGLISH WORD LIST — for brainstorming only, not dictionary or legal certification
   ========================================================================== */
const VERIFIED_DICTIONARY = {
  2: [
    'on', 'in', 'at', 'to', 'up', 'go', 'by', 'my', 'we', 'do', 'no', 'so', 'us', 'if',
    'me', 'he', 'as', 'ox', 'am', 'an', 'be', 'is', 'it', 'id', 're', 'ex'
  ],
  3: [
    'tap', 'hub', 'box', 'bit', 'key', 'net', 'jet', 'pay', 'pro', 'tip', 'run', 'fly',
    'web', 'bot', 'max', 'fox', 'day', 'sky', 'sun', 'top', 'pin', 'eye', 'map', 'dot',
    'cat', 'bar', 'fit', 'cup', 'car', 'law', 'air', 'joy', 'hit', 'bed', 'tag', 'log',
    'gem', 'red', 'fan', 'win', 'row', 'low', 'sea', 'ice', 'bay', 'owl', 'cap', 'dip',
    'pod', 'rug', 'oak', 'vet', 'ray', 'ace', 'arc', 'kit', 'aid', 'ink', 'out', 'bag',
    'bow', 'gut', 'lab', 'pen', 'fog', 'rib', 'jar', 'bat', 'dry', 'wax', 'pot', 'toe',
    'dew', 'oil', 'pop', 'raw', 'rod', 'sow', 'tin', 'van', 'zip', 'act', 'add', 'aim',
    'arm', 'art', 'ash', 'ask', 'bad', 'bee', 'beg', 'bet', 'bid', 'big', 'bin', 'bus',
    'buy', 'cab', 'can', 'cop', 'cow', 'cry', 'cut', 'dig', 'dim', 'dog', 'due', 'ear',
    'eat', 'egg', 'ego', 'end', 'era', 'eve', 'far', 'fat', 'fed', 'few', 'fig', 'for',
    'fun', 'fur', 'gas', 'got', 'gum', 'gun', 'guy', 'gym', 'had', 'ham', 'has', 'hay',
    'hen', 'her', 'hid', 'him', 'hip', 'his', 'hop', 'hot', 'how', 'hug', 'hut', 'ill',
    'ion', 'jam', 'jaw', 'job', 'jog', 'jug', 'kid', 'kin', 'lad', 'lap', 'lay', 'led',
    'leg', 'let', 'lid', 'lie', 'lip', 'lit', 'mad', 'man', 'mat', 'may', 'men', 'met',
    'mid', 'mix', 'mob', 'mom', 'mop', 'mud', 'mug', 'nap', 'new', 'nod', 'not', 'now',
    'nut', 'oar', 'odd', 'off', 'old', 'opt', 'our', 'pad', 'pal', 'pat', 'paw', 'pea',
    'peg', 'pet', 'pig', 'pit', 'ply', 'pun', 'pup', 'rag', 'ram', 'ran', 'rap', 'rat',
    'rid', 'rig', 'rip', 'rob', 'rot', 'rub', 'rye', 'sad', 'sap', 'sat', 'saw', 'say',
    'set', 'sew', 'she', 'shy', 'sin', 'sip', 'sir', 'sit', 'six', 'ski', 'spy', 'sum',
    'tan', 'tax', 'ten', 'the', 'tie', 'too', 'toy', 'try', 'tub', 'two', 'use', 'via',
    'vow', 'war', 'wet', 'who', 'why', 'wig', 'wit', 'yes', 'yet', 'zoo', 'apt', 'biz',
    'col', 'cpu', 'dev', 'dns', 'doc', 'dom', 'eco', 'faq', 'geo', 'git', 'hex', 'lux',
    'mod', 'ops', 'org', 'pic', 'pos', 'pub', 'sec', 'sub', 'sys', 'tel', 'usd', 'eur',
    'val', 'vip', 'vox', 'vib', 'zap', 'zen', 'sol', 'orb', 'axe', 'rad', 'roc'
  ],
  4: [
    'cash', 'flow', 'wire', 'mint', 'safe', 'wave', 'pass', 'edge', 'fund', 'bank',
    'card', 'sync', 'grid', 'save', 'core', 'fast', 'drop', 'snap', 'link', 'line',
    'tech', 'node', 'base', 'nest', 'peak', 'gain', 'seed', 'beam', 'volt', 'path',
    'park', 'iron', 'rock', 'gold', 'coin', 'ring', 'view', 'room', 'star', 'hill',
    'wind', 'fire', 'hero', 'blue', 'calm', 'tree', 'gate', 'fish', 'wolf', 'bird',
    'door', 'lock', 'bell', 'shop', 'food', 'meal', 'pool', 'tool', 'gear', 'post',
    'mark', 'icon', 'code', 'byte', 'data', 'sign', 'test', 'wall', 'team', 'step',
    'spin', 'lift', 'dial', 'rush', 'zoom', 'surf', 'echo', 'glow', 'jump', 'bond',
    'fine', 'rich', 'pure', 'bold', 'free', 'keen', 'warm', 'soft', 'wild', 'neat',
    'epic', 'real', 'true', 'open', 'next', 'wide', 'deep', 'apex', 'arch', 'aura',
    'boat', 'bolt', 'book', 'camp', 'cape', 'cave', 'clay', 'coal', 'cove', 'dawn',
    'deer', 'dock', 'dove', 'dune', 'dust', 'ever', 'fair', 'farm', 'fern', 'flag',
    'ford', 'fort', 'frost', 'gale', 'gulf', 'halo', 'hive', 'home', 'horn', 'isle',
    'jade', 'lake', 'lamp', 'lane', 'leaf', 'lime', 'lion', 'loop', 'luna', 'maze',
    'moon', 'moss', 'nova', 'opal', 'palm', 'pine', 'pond', 'rain', 'reed', 'reef',
    'rose', 'ruby', 'sage', 'sail', 'sand', 'silk', 'snow', 'stem', 'swan', 'tide',
    'vale', 'vine', 'wood', 'yard', 'byte', 'host', 'meta', 'ping', 'root', 'mesh',
    'cell', 'feed', 'plug', 'pack', 'hook', 'load', 'lead', 'dash', 'grow', 'work',
    'make', 'send', 'view', 'keep', 'help', 'find', 'meet', 'chat', 'talk', 'join',
    'task', 'plan', 'pace', 'rise', 'turn', 'cast', 'flex', 'plus', 'mate', 'wise',
    'zone', 'spot', 'vibe', 'easy', 'live', 'earn', 'loan', 'lend', 'risk', 'hold',
    'rate', 'swap', 'unit', 'cent', 'bill', 'peer', 'cost', 'sale', 'cart', 'paid',
    'debt', 'firm', 'ship', 'mail', 'auto', 'fuel', 'pump', 'pipe', 'vent', 'mast',
    'hull', 'prop', 'wing', 'tire', 'ramp', 'deck', 'span', 'rail', 'cord', 'fuse',
    'slot', 'clip', 'grip', 'bolt', 'knob', 'seal', 'band', 'hoop', 'disc', 'cone',
    'cube', 'ball', 'drum', 'tone', 'note', 'tune', 'song', 'word', 'text', 'page',
    'form', 'file', 'list', 'menu', 'memo', 'stamp', 'tape', 'glue', 'bind', 'rope',
    'wool', 'bark', 'cork', 'cane', 'rush', 'stem', 'twig', 'knot', 'grain', 'pith',
    'sap', 'gum', 'tar', 'wax', 'fat', 'oil', 'soap', 'foam', 'scum', 'rust', 'crust',
    'rind', 'peel', 'case', 'sack', 'pack', 'bale', 'pile', 'heap', 'dune', 'pier',
    'dock', 'port', 'road', 'lane', 'flux', 'tide', 'soar', 'leap', 'walk', 'hunt'
  ],
  5: [
    'vault', 'trust', 'cloud', 'pulse', 'smart', 'boost', 'shift', 'scale', 'flash',
    'vista', 'orbit', 'trade', 'token', 'swift', 'prime', 'point', 'guard', 'stack',
    'block', 'chain', 'spark', 'nexus', 'glide', 'atlas', 'river', 'forge', 'scope',
    'track', 'layer', 'solar', 'ocean', 'cyber', 'brain', 'power', 'light', 'titan',
    'hyper', 'super', 'alpha', 'blaze', 'crest', 'crown', 'drift', 'oasis', 'quest',
    'ridge', 'radar', 'sound', 'stone', 'space', 'tempo', 'unity', 'union', 'valve',
    'vigor', 'world', 'yield', 'zebra', 'logic', 'dream', 'claim', 'field', 'storm',
    'shine', 'prism', 'giant', 'route', 'shock', 'force', 'frame', 'guide', 'pilot',
    'pixel', 'agent', 'board', 'brave', 'charm', 'clock', 'craft', 'elite', 'flora',
    'grain', 'grand', 'index', 'label', 'match', 'medal', 'phase', 'plant', 'range',
    'share', 'shield', 'skill', 'stamp', 'suite', 'asset', 'worth', 'check', 'audit',
    'stake', 'float', 'hedge', 'funds', 'swipe', 'spend', 'score', 'stash', 'micro',
    'macro', 'lease', 'intel', 'model', 'robot', 'query', 'graph', 'patch', 'infra',
    'cache', 'array', 'drive', 'input', 'relay', 'reach', 'build', 'focus', 'align',
    'click', 'shape', 'start', 'climb', 'count', 'draft', 'solve', 'speed', 'stand',
    'sweep', 'train', 'amber', 'apple', 'arrow', 'badge', 'basin', 'beach', 'berry',
    'birch', 'blade', 'bloom', 'brook', 'cedar', 'cliff', 'coral', 'daisy', 'delta',
    'eagle', 'ember', 'flame', 'flock', 'forest', 'frost', 'glade', 'globe', 'grove',
    'haven', 'hazel', 'honey', 'jewel', 'laser', 'lemon', 'lotus', 'maple', 'marsh',
    'metal', 'miner', 'mount', 'north', 'olive', 'pearl', 'petal', 'plain', 'plaza',
    'polar', 'poppy', 'raven', 'robin', 'tiger', 'tulip', 'valley', 'vapor', 'viper',
    'vivid', 'water', 'wheat', 'solid', 'sharp', 'quick', 'ahead', 'first', 'ultra',
    'omni', 'flair', 'blend', 'brisk', 'broad', 'chill', 'clean', 'crisp', 'equal',
    'exact', 'extra', 'faint', 'fancy', 'feast', 'fiery', 'final', 'fleet', 'fresh',
    'front', 'great', 'green', 'ideal', 'inner', 'joint', 'jumbo', 'keen', 'large',
    'loyal', 'lucky', 'magic', 'major', 'merry', 'minor', 'moral', 'noble', 'novel',
    'outer', 'proud', 'quiet', 'rapid', 'ready', 'rigid', 'rough', 'round', 'royal',
    'rusty', 'saint', 'shady', 'sheer', 'shiny', 'short', 'silky', 'sleek', 'slick',
    'slight', 'slim', 'small', 'smooth', 'snug', 'sober', 'soft', 'sour', 'spare',
    'spicy', 'stark', 'steep', 'stiff', 'still', 'stout', 'sunny', 'sweet', 'thick',
    'tight', 'tough', 'urban', 'valid', 'vital', 'vocal', 'warm', 'wild', 'young'
  ],
  6: [
    'wallet', 'direct', 'market', 'system', 'portal', 'engine', 'stream', 'studio',
    'matrix', 'impact', 'vector', 'beacon', 'fusion', 'summit', 'shield', 'horizon',
    'native', 'secure', 'global', 'credit', 'target', 'anchor', 'avenue', 'bridge',
    'castle', 'circle', 'future', 'growth', 'launch', 'modern', 'nation', 'nature',
    'palace', 'planet', 'pocket', 'rocket', 'sensor', 'silver', 'source', 'spirit',
    'status', 'valley', 'voyage', 'wonder', 'genius', 'galaxy', 'crypto', 'dollar',
    'invest', 'stripe', 'clever', 'charge', 'escrow', 'payout', 'equity', 'simple',
    'fluent', 'border', 'wealth', 'square', 'neural', 'server', 'docker', 'deploy',
    'vision', 'signal', 'socket', 'prompt', 'script', 'lambda', 'thread', 'tuning',
    'expert', 'spider', 'parser', 'metric', 'tensor', 'create', 'manage', 'sprint',
    'engage', 'expand', 'gather', 'handle', 'invent', 'master', 'agile', 'assist',
    'action', 'verify', 'update', 'unlock', 'travel', 'review', 'refine', 'alpine',
    'aurora', 'autumn', 'breeze', 'canopy', 'canyon', 'cherry', 'clover', 'comet',
    'copper', 'cosmos', 'crater', 'falcon', 'garden', 'harbor', 'island', 'jungle',
    'nebula', 'quarry', 'quartz', 'safari', 'season', 'shadow', 'sunset', 'timber',
    'tunnel', 'vessel', 'violet', 'winter', 'accent', 'access', 'accord', 'account',
    'active', 'actual', 'acumen', 'adhere', 'adjust', 'admire', 'advent', 'advice',
    'advise', 'aerial', 'affair', 'affect', 'affirm', 'afford', 'agenda', 'agents',
    'airway', 'alerts', 'allied', 'allure', 'almond', 'alpine', 'amount', 'anchor',
    'animal', 'annual', 'answer', 'appeal', 'appear', 'arctic', 'ardent', 'armada',
    'artist', 'aspect', 'assert', 'assign', 'atomic', 'banner', 'barrel', 'beacon'
  ]
};

/* Brandable / Invented syllables (Only used when Strict Mode is OFF) */
const CREATIVE_BRANDABLES = {
  2: ['ox', 'ex', 'vx', 'nx', 'fx', 'dx', 'rx', 'zx', 'qa', 'hq', 'ui', 'io', 'ai'],
  3: ['vex', 'vox', 'vib', 'zap', 'zen', 'sol', 'lux', 'orb', 'lum', 'roc', 'pod', 'pix', 'lyn', 'syn', 'kiv', 'zyp', 'qur'],
  4: ['livo', 'zype', 'kivo', 'plux', 'dyno', 'velo', 'quox', 'viva', 'nexo', 'axon', 'jolt', 'vibe', 'flux', 'flex'],
  5: ['livoj', 'novax', 'zylos', 'vivid', 'vexel', 'quora', 'zeniq', 'kinet', 'fluxo', 'solis', 'orbis'],
  6: ['nexora', 'veltra', 'zylent', 'fluxis', 'kivora', 'dynexi', 'voltra', 'quante']
};

/* Supplemental 7+ partner words; the existing 2–6 letter lists above stay unchanged. */
const LONG_PARTNER_WORDS = [
  'account', 'advance', 'advisor', 'airflow', 'amplify', 'archive', 'artisan', 'awesome', 'balance', 'banking',
  'benefit', 'blossom', 'booking', 'branding', 'builder', 'business', 'catalyst', 'central', 'channel', 'clarity',
  'climate', 'compass', 'connect', 'creator', 'culture', 'current', 'digital', 'discover', 'durable', 'dynamic',
  'elegant', 'elevate', 'empower', 'enhance', 'explore', 'factory', 'feature', 'finance', 'fitness', 'flourish',
  'focused', 'forward', 'founder', 'freedom', 'frontier', 'gateway', 'genesis', 'harmony', 'harvest', 'healthy',
  'helpful', 'horizon', 'imagine', 'improve', 'insight', 'journey', 'lantern', 'launchpad', 'leading', 'luminous',
  'message', 'mindful', 'mission', 'monitor', 'morning', 'network', 'optimize', 'organic', 'outline', 'partner',
  'payment', 'pioneer', 'platform', 'premium', 'progress', 'project', 'quantum', 'quality', 'radiant', 'reliable',
  'resolve', 'resource', 'revenue', 'service', 'sparkle', 'special', 'storage', 'strategy', 'success', 'support',
  'synergy', 'tailored', 'thriving', 'together', 'toolbox', 'transit', 'trusted', 'venture', 'vibrant', 'victory',
  'village', 'wellness', 'workflow', 'blueprint', 'creative', 'evergreen', 'framework', 'greenfield', 'northstar',
  'marketplace', 'lighthouse', 'wildflower', 'resilient', 'engineering', 'possibility', 'imagination', 'technology'
];

const CATEGORY_KEYWORDS = {
  fintech: ['pay', 'cash', 'coin', 'money', 'bank', 'fund', 'wallet', 'crypto', 'lend', 'loan', 'card', 'save', 'vest', 'earn', 'bill', 'tax', 'cost', 'trade', 'settle', 'wealth'],
  tech_ai: ['ai', 'data', 'cloud', 'code', 'dev', 'doc', 'host', 'server', 'byte', 'bot', 'deep', 'intel', 'algo', 'net', 'stack', 'mesh', 'sys', 'query', 'model', 'agent'],
  saas_action: ['work', 'task', 'flow', 'team', 'lead', 'run', 'grow', 'jump', 'dash', 'lift', 'sync', 'track', 'form', 'desk', 'hire', 'meet', 'crm', 'collab']
};
