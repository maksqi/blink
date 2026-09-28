/**
 * Common-password denylist (server-core), lowercase ASCII. Compiled from the most frequent entries of public
 * password-leak statistics. Short entries matter too: `checkPasswordPolicy` also rejects them when padded with
 * digits or symbols ("password2024!") or written in simple leetspeak ("p@ssw0rd").
 */
export const COMMON_PASSWORDS: readonly string[] = [
  // Numbers and keyboard walks
  '0000', '000000', '00000000', '000000000000', '1111', '11111', '111111', '1111111', '11111111', '111111111111',
  '112233', '121212', '123123', '123123123', '123321', '1234', '12345', '123456', '1234567', '12345678',
  '123456789', '1234567890', '12345678910', '123456789012', '1234567890123', '12344321', '123654', '123654789',
  '123qwe', '123abc', '131313', '147258369', '159753', '159357', '222222', '232323', '333333', '444444', '555555',
  '654321', '666666', '7777777', '777777', '87654321', '888888', '88888888', '987654', '987654321', '999999',
  '1q2w3e', '1q2w3e4r', '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx', '1qaz2wsx3edc', '1qazxsw2', 'q1w2e3r4',
  'q1w2e3r4t5', 'q1w2e3r4t5y6', 'qazwsx', 'qazwsxedc', 'qazwsxedcrfv', 'qwe123', 'qwer1234', 'qwerty',
  'qwerty1', 'qwerty12', 'qwerty123', 'qwerty1234', 'qwerty123456', 'qwertyqwerty', 'qwertyui', 'qwertyuiop',
  'qwertyuiop123', 'asdf', 'asdfgh', 'asdfghjk', 'asdfghjkl', 'asdfasdf', 'asd123', 'zxcvbn', 'zxcvbnm',
  'zxcvbnm123', 'zaq12wsx', 'zaq1zaq1', 'zaq12wsxcde3', 'abc123', 'abc12345', 'abcd1234', 'abcdef', 'abcdefg',
  'abcdefgh', 'abcdefghijkl', 'aaaaaa', 'aaaaaaaa', 'xxxxxx', 'xxxxxxxx', 'a1b2c3', 'a1b2c3d4', '1a2b3c',
  // Generic words
  'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'pa55word', 'pass', 'pass123', 'pass1234', 'passpass',
  'password1', 'password12', 'password123', 'password1234', 'passwordpassword', 'mypassword', 'newpassword',
  'secret', 'secret123', 'letmein', 'letmein123', 'welcome', 'welcome1', 'welcome123', 'login', 'login123',
  'admin', 'admin1', 'admin123', 'admin1234', 'administrator', 'root', 'toor', 'changeme', 'changeit', 'default',
  'guest', 'user', 'user123', 'test', 'test123', 'test1234', 'testing', 'testtest', 'demo', 'temp', 'temppass',
  'master', 'access', 'enter', 'hello', 'hello123', 'helloworld', 'whatever', 'nothing', 'please', 'trustno1',
  'iloveyou', 'iloveu', 'love', 'lovely', 'loveme', 'forever', 'freedom', 'friends', 'secure', 'security',
  'private', 'internet', 'computer', 'server', 'system', 'network', 'office', 'company', 'business', 'money',
  'monkey', 'dragon', 'shadow', 'sunshine', 'princess', 'superman', 'batman', 'spiderman', 'starwars', 'pokemon',
  'minecraft', 'football', 'baseball', 'basketball', 'soccer', 'hockey', 'tennis', 'golf', 'golfer', 'fishing',
  'hunter', 'hunting', 'killer', 'ninja', 'pirate', 'warrior', 'soldier', 'knight', 'wizard', 'merlin', 'gandalf',
  'matrix', 'phoenix', 'thunder', 'lightning', 'rainbow', 'summer', 'winter', 'spring', 'autumn', 'flower',
  'garden', 'orange', 'banana', 'apple', 'cherry', 'peach', 'lemon', 'coffee', 'chocolate', 'cookie', 'cheese',
  'pepper', 'ginger', 'honey', 'sugar', 'candy', 'angel', 'angels', 'heaven', 'diamond', 'crystal', 'silver',
  'golden', 'purple', 'yellow', 'blue', 'green', 'black', 'white', 'red', 'pink', 'tiger', 'tigger', 'lion',
  'eagle', 'eagles', 'falcon', 'dolphin', 'rabbit', 'bunny', 'kitten', 'puppy', 'doggy', 'bulldog', 'bigdog',
  'cowboy', 'cowboys', 'chicken', 'turtle', 'monster', 'spider', 'snoopy', 'scooby', 'mickey', 'pumpkin',
  'peanut', 'sparky', 'buster', 'bandit', 'bailey', 'maggie', 'molly', 'charlie', 'buddy', 'rocky', 'max',
  'jasper', 'oliver', 'toby', 'lucky', 'smokey', 'shadow1', 'master1', 'dragon1', 'monkey1', 'letmein1',
  'football1', 'baseball1', 'princess1', 'sunshine1', 'superman1', 'iloveyou1', 'qwerty12345', 'welcome12',
  // Names
  'michael', 'jennifer', 'jessica', 'ashley', 'amanda', 'andrew', 'anthony', 'daniel', 'david', 'thomas',
  'robert', 'richard', 'william', 'joseph', 'joshua', 'matthew', 'christopher', 'charles', 'james', 'john',
  'johnny', 'george', 'edward', 'steven', 'justin', 'brandon', 'patrick', 'jordan', 'taylor', 'morgan',
  'michelle', 'nicole', 'melissa', 'heather', 'samantha', 'hannah', 'rachel', 'natasha', 'victoria', 'jasmine',
  'andrea', 'marina', 'elizabeth', 'maria', 'sophie', 'emily', 'sarah', 'laura', 'alexander', 'alex', 'martin',
  'miller', 'jackson', 'austin', 'dallas', 'boston', 'chicago', 'london', 'paris', 'berlin', 'madrid',
  // Brands, teams and pop culture
  'ferrari', 'porsche', 'mercedes', 'corvette', 'mustang', 'camaro', 'yamaha', 'harley', 'samsung', 'apple123',
  'google', 'facebook', 'twitter', 'youtube', 'microsoft', 'windows', 'linux', 'ubuntu', 'android', 'iphone',
  'nintendo', 'playstation', 'xbox', 'cocacola', 'pepsi', 'marlboro', 'adidas', 'nike', 'disney', 'lakers',
  'yankees', 'redsox', 'steelers', 'raiders', 'packers', 'arsenal', 'chelsea', 'liverpool', 'barcelona',
  'realmadrid', 'juventus', 'nascar', 'slayer', 'metallica', 'nirvana', 'beatles', 'elvis', 'matrix1',
  'ncc1701', 'startrek', 'jedi', 'skywalker', 'vader', 'hogwarts', 'voldemort', 'gfhjkm', 'ghbdtn', 'qweasd',
  'qweasdzxc', 'qwaszx', '1qwerty', 'zaqxswcde',
  // Video meetings and this product
  'blinq', 'blinq123', 'blinqadmin', 'meeting', 'meetings', 'conference', 'videocall', 'video', 'webcam',
  'zoom', 'zoom123', 'zoommeeting', 'teams', 'skype', 'jitsi', 'webex', 'livekit',
  // Passphrases that appear in every leak
  'correcthorsebatterystaple', 'iloveyouiloveyou', 'letmeinletmein', 'trustnoone', 'opensesame',
  'thequickbrownfox', 'ihateyou', 'loveyou', 'mylove', 'myname', 'mypass', 'nopassword', 'noaccess',
]
