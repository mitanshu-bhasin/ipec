export const bannedKeywords = [
    'fuck',
    'behcnhodh',
    'acc',
    'scam',
    'fake',
    'bitch',
    'idiot',
    'bhosdike',
    'chutiya',
    'mc',
    'bc',
    'madarchod',
    'bhenchid',
    'kutta',
    'kamina',
    'harami',
    'bsdk',
    'bkl',
    'porn',
    'bullshit',
    'fraud',
    'bastard',
    'asshole',
    'dick',
    'pussy',
    'cunt',
    'shit',
    'damn',
    'hell',
    'stupid',
    'moron',
    'retard'
];

export const checkSpam = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    return bannedKeywords.some(word => lowerText.includes(word.toLowerCase()));
};
