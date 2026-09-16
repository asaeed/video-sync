const commonMoments = [18, 64, 118, 176, 244, 328, 414, 506];

// Four additional, widely spaced source moments for every playable film scene.
// These expand the working palette without duplicating the original eight edits.
const playableSceneExpansions = {
  "gumby-clay-trip": {
    labels: ["Toy-town drive", "Tin knight", "Clay forest walk", "Piano toy parade"],
    moments: [245, 540, 925, 1325],
  },
  "swing-you-sinners": {
    labels: ["Graveyard pursuit", "Rubber-hose specters", "Dancing tombstones", "Infernal chase"],
    moments: [102, 218, 337, 405],
  },
  fiddlesticks: {
    labels: ["Forest percussion", "Dancing piano keys", "Animal bandstand", "Elastic dance break"],
    moments: [75, 174, 274, 326],
  },
  "skeleton-dance": {
    labels: ["Graveyard march", "Bone percussion line", "Skeleton spin", "Dawn scramble"],
    moments: [48, 80, 144, 210],
  },
  "prince-achmed": {
    labels: ["Flying horse ascent", "Ornate throne court", "Magic lamp summons", "Silhouette battle"],
    moments: [700, 1750, 2795, 3600],
  },
  "trip-to-the-moon": {
    labels: ["Rocket foundry", "Astronomers march", "Selenite swarm", "Ocean recovery"],
    moments: [250, 400, 495, 615],
  },
  "king-of-jazz": {
    labels: ["Fan chorus", "Emerald duet", "Comic duet", "Grand revue formation"],
    moments: [1200, 2100, 3900, 5300],
  },
  whoopee: {
    labels: ["Desert motorcade", "Cowboy dance line", "Technicolor stage whirl", "Kitchen rush"],
    moments: [600, 1320, 2040, 2520],
  },
  "gullivers-travels": {
    labels: ["Royal argument", "Night sea voyage", "Blefuscu shoreline", "Mountain cavern"],
    moments: [720, 2040, 3300, 4080],
  },
  "nothing-sacred": {
    labels: ["Small-town interview", "Headline arrival", "Bedside performance", "Newsroom telephone"],
    moments: [600, 1380, 2520, 3660],
  },
  charade: {
    labels: ["Embassy conversation", "Apartment embrace", "Night harbor", "Shadowed hallway"],
    moments: [900, 2400, 4800, 6300],
  },
  "cameramans-revenge": {
    labels: ["Beetle bank entrance", "Insect pursuit", "Fireplace ambush", "Shopfront escape"],
    moments: [76, 206, 426, 626],
  },
  "the-lodger": {
    labels: ["Landlady at the door", "Drawing-room vigil", "Portrait and chandelier", "Night pursuit"],
    moments: [900, 1660, 2760, 4500],
  },
  underworld: {
    labels: ["Tenement gathering", "Gangster and flapper", "Prison bars", "Night motorcar"],
    moments: [510, 1350, 2940, 4200],
  },
  "docks-of-new-york": {
    labels: ["Stairwell silhouette", "Dockside silhouettes", "Tavern dance", "Foggy passage"],
    moments: [800, 1450, 3000, 3900],
  },
  haxan: {
    labels: ["Witch's table", "Ritual gathering", "Dark visitor", "Possessed close-up"],
    moments: [1100, 2250, 3980, 3400],
  },
  nosferatu: {
    labels: ["Carpathian crossing", "Orlok corridor", "Cross-marked doors", "Sickroom shadows"],
    moments: [1200, 2800, 4460, 4750],
  },
  "cat-and-canary": {
    labels: ["Chandelier séance", "Mansion alarm", "Blue staircase", "Lawyer close-up"],
    moments: [1100, 2200, 3315, 4300],
  },
  usher: {
    labels: ["Surreal staircase", "Pendulum shadows", "Coffin geometry", "Collapsing house"],
    moments: [150, 300, 470, 630],
  },
  aelita: {
    labels: ["Workers' dining hall", "Industrial construction", "Factory corridor", "Martian staircase"],
    moments: [1230, 3600, 4500, 5840],
  },
  "woman-in-moon": {
    labels: ["Cabin controls", "Zero-gravity cabin", "Engine-room ladder", "Lunar canyon"],
    moments: [5650, 6300, 7200, 8500],
  },
  "crazy-ray": {
    labels: ["Frozen boulevard", "Stopped traffic", "Eiffel Tower scramble", "Laboratory pulse"],
    moments: [420, 780, 1320, 1800],
  },
  "mechanical-man": {
    labels: ["Men at the door", "Blue-night rescue", "Electrical ambush", "Horse-cart pursuit"],
    moments: [320, 520, 820, 1108],
  },
  "iron-horse": {
    labels: ["Formal reception", "Frontier couple", "Town-square standoff", "Train and horse chase"],
    moments: [1300, 3170, 5350, 7400],
  },
  "three-bad-men": {
    labels: ["Frontier crowd", "Saloon confrontation", "Flirtation close-up", "Wagon stampede"],
    moments: [1278, 2000, 3000, 4200],
  },
  "movie-camera": {
    labels: ["City wakes", "Tramline rhythm", "Athletic montage", "Camera-machine finale"],
    moments: [750, 1850, 2550, 3650],
  },
  "ballet-mecanique": {
    labels: ["Orbital spheres", "Abstract shutters", "String-line lattice", "Prismatic portrait"],
    moments: [110, 220, 350, 620],
  },
};

const film = (id, name, style, labels, options = {}) => {
  const expansion = options.availability === "ready" ? playableSceneExpansions[id] : null;
  return {
    id,
    name,
    style,
    group: options.group ?? "Public-domain film",
    availability: options.availability ?? "source-needed",
    rights: options.rights ?? "Public-domain source candidate; verify the chosen scan and score before distribution.",
    sourcePage: options.sourcePage ?? null,
    archiveId: options.archiveId ?? null,
    preferredFile: options.preferredFile ?? null,
    sourceMediaUrl: options.sourceMediaUrl ?? null,
    sourcePath: options.sourcePath ?? `../assets/library/${id}/source.mp4`,
    moments: [...(options.moments ?? commonMoments), ...(expansion?.moments ?? [])],
    labels: [...labels, ...(expansion?.labels ?? [])],
    fit: options.fit ?? "contain",
  };
};

export const SCENE_CATALOG = [
  {
    id: "metropolis-machine",
    name: "Metropolis Machine",
    style: "Monumental industrial futurism",
    group: "Playable now",
    availability: "ready",
    rights: "Metropolis (1927), public-domain U.S. release source.",
    sourcePage: "https://en.wikisource.org/wiki/File:Metropolis_(1927,_English_titles_1930s).webm",
    fit: "contain",
    clips: [
      ["Robot reveal", "../assets/scenes/metropolis/robot-reveal.mp4", 0],
      ["Transformation rings", "../assets/scenes/metropolis/transformation-rings.mp4", 1],
      ["City machines", "../assets/scenes/metropolis/city-machines.mp4", 0.5],
      ["Workers underground", "../assets/scenes/metropolis/workers-underground.mp4", 1.5],
      ["Shift march", "../assets/scenes/metropolis/shift-march.mp4", 0],
      ["City canyon", "../assets/scenes/metropolis/city-canyon.mp4", 0.5],
      ["Moloch machine", "../assets/scenes/metropolis/moloch-machine.mp4", 1],
      ["Clock worker", "../assets/scenes/metropolis/clock-worker.mp4", 0],
      ["Babel tower", "../assets/scenes/metropolis/babel-tower.mp4", 0.5],
      ["False Maria dance", "../assets/scenes/metropolis/false-maria-dance.mp4", 1],
      ["Flood surge", "../assets/scenes/metropolis/flood-surge.mp4", 0],
      ["Cathedral rescue", "../assets/scenes/metropolis/cathedral-rescue.mp4", 1],
    ],
  },
  film("gumby-clay-trip", "Gumby Clay Trip", "Surreal mid-century clay animation", ["Gumbasia drift", "Musical spheres", "Piano lineup", "Fire truck miniature", "Dragon court", "Target machine", "Gumby confrontation", "Piano concert"], {
    group: "Internet footage",
    availability: "ready",
    archiveId: "gumby-02",
    preferredFile: "Gumby_02.mp4",
    sourcePage: "https://archive.org/details/gumby-02",
    moments: [160, 300, 465, 600, 800, 1050, 1200, 1500],
    rights: "Internet Archive Gumby compilation selected at the user's request; rights are not stated on the item and must be verified before public distribution.",
  }),

  film("swing-you-sinners", "Swing You Sinners!", "Fleischer nightmare jazz", ["Bimbo on the run", "Ghost procession", "Tree faces", "Barnyard panic", "Skull chorus", "Shadow chase", "Impossible staircase", "Dawn escape"], {
    availability: "ready", archiveId: "1930_Swing_You_Sinners", preferredFile: "videoplayback (12).mp4", sourcePage: "https://archive.org/details/1930_Swing_You_Sinners", moments: [45, 72, 126, 184, 242, 302, 365, 430],
  }),
  film("fiddlesticks", "Fiddlesticks", "Bright early synchronized cartoon", ["Flip enters", "Piano bounce", "Forest dance", "Band assembly", "Elastic instruments", "Animal chorus", "Stage tumble", "Finale"], {
    availability: "ready", archiveId: "Fiddlesticks1930UbIwerks", preferredFile: "Fiddlesticks 1930  Ub Iwerks.mp4", sourcePage: "https://archive.org/details/Fiddlesticks1930UbIwerks", moments: [24, 54, 98, 145, 198, 246, 301, 348],
  }),
  film("skeleton-dance", "The Skeleton Dance", "Macabre rhythmic animation", ["Moonlit owl", "Skeleton rise", "Bone xylophone", "Cat stretch", "Owl swivel", "Skeleton quartet", "Body swap", "Sunrise retreat"], { availability: "ready", archiveId: "the-skeleton-dance-1929-hd", preferredFile: "The_Skeleton_Dance_(1929) HD.mp4", sourcePage: "https://archive.org/details/the-skeleton-dance-1929-hd", moments: [22, 34, 62, 94, 126, 158, 190, 226] }),
  film("prince-achmed", "The Adventures of Prince Achmed", "Ornate silhouette fantasy", ["Witch's spell", "Silhouette lovers", "Palace procession", "Flying horse", "Enchanted grove", "Scarlet shadow court", "Demon duel", "Moonlit return"], {
    availability: "ready",
    archiveId: "the-adventures-of-prince-achmed-1926-by-carl-koch",
    preferredFile: "The.Adventures.Of.Prince.Achmed.1926.1080p.BluRay.x264.AAC-[YTS.MX].mp4",
    sourcePage: "https://archive.org/details/the-adventures-of-prince-achmed-1926-by-carl-koch",
    moments: [160, 480, 900, 1160, 1500, 2100, 3300, 3800],
    rights: "Internet Archive item is marked Public Domain; its Blu-ray-derived restoration and score may carry separate rights. Audio is omitted from the local performance clips.",
  }),
  film("trip-to-the-moon", "A Trip to the Moon", "Méliès lunar stage magic", ["Moon-face impact", "Rocket workshop", "Launch chorus", "Celestial ballet", "Giant mushroom grove", "Selenite ambush", "Lunar court revolt", "Capsule cliff escape"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Le_Voyage_dans_la_Lune_(1902).webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/6/6d/Le_Voyage_dans_la_Lune_%281902%29.webm/Le_Voyage_dans_la_Lune_%281902%29.webm.1080p.vp9.webm",
    moments: [364, 210, 326, 462, 517, 544, 578, 645],
    rights: "A Trip to the Moon (1902). Wikimedia Commons applies the Public Domain Mark and identifies this scan as free of known restrictions. The local clips omit audio and do not use the modern color restoration or AIR score.",
  }),
  film("king-of-jazz", "King of Jazz", "Two-color Technicolor revue geometry", ["Overhead strings", "Chorus line", "Feather trio", "Silhouette dance", "Emerald orchestra", "Solo tap stage", "Crimson spectacle", "Finale dancers"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:King_of_Jazz_(1930).webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/fe/King_of_Jazz_%281930%29.webm/King_of_Jazz_%281930%29.webm.480p.vp9.webm",
    moments: [480, 600, 2520, 3120, 3360, 4440, 5040, 5640],
    rights: "King of Jazz (1930). Wikimedia Commons marks the original film public domain in the United States because it was published before 1931. Local clips omit audio; verify the source and territory before public distribution.",
  }),
  film("whoopee", "Whoopee!", "Technicolor musical-western spectacle", ["Courtyard ring dance", "Courtyard dance", "Stage chorus", "Feather formation", "Motorcar rush", "Chorus procession", "Kitchen collision", "Kitchen slapstick"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Whoopee!_(1930).webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/71/Whoopee%21_%281930%29.webm/Whoopee%21_%281930%29.webm.480p.vp9.webm",
    moments: [240, 1020, 1500, 1560, 2220, 120, 2700, 2880],
    rights: "Whoopee! (1930). Wikimedia Commons marks the film public domain in the United States because it was published before 1931. Local clips omit audio and avoid the source's most objectionable period-stereotype sequences.",
  }),
  film("gullivers-travels", "Gulliver's Travels", "Fleischer Technicolor fantasy", ["Storm at sea", "Lantern patrol", "Night machinery", "Toy-box fleet", "Town uprising", "Villain scramble", "Painted war map", "Prince in rigging"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Gulliver%27s_Travels_(1939).webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/b/bb/Gulliver%27s_Travels_%281939%29.webm/Gulliver%27s_Travels_%281939%29.webm.480p.vp9.webm",
    moments: [180, 1320, 1680, 2460, 2820, 3000, 3900, 4320],
    rights: "Gulliver's Travels (1939). Wikimedia Commons identifies the U.S. film copyright as not renewed and marks the work public domain in the United States. Local clips omit audio; other territories may differ.",
  }),
  film("nothing-sacred", "Nothing Sacred", "Technicolor screwball city", ["Manhattan flyover", "Boxing spectacle", "Golden stage", "Floral spectacle", "Night arrival", "Shadow gathering", "Press racket", "Noir farewell"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Nothing_Sacred_(1937)_by_William_A._Wellman.webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7b/Nothing_Sacred_%281937%29_by_William_A._Wellman.webm/Nothing_Sacred_%281937%29_by_William_A._Wellman.webm.480p.vp9.webm",
    moments: [1260, 1560, 1800, 2220, 2880, 3000, 3120, 4320],
    rights: "Nothing Sacred (1937). Wikimedia Commons marks the film public domain in the United States because its copyright was not renewed. Local clips omit audio; verify the source and territory before public distribution.",
  }),
  film("charade", "Charade", "Mod Paris thriller", ["Alpine terrace", "Scarlet Paris", "Audrey close-up", "Funeral geometry", "Rotary signal", "Midnight motorcar", "Metro pursuit", "Mechanical trap"], {
    availability: "ready",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Charade_(1963).webm",
    sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/d/dc/Charade_%281963%29.webm",
    moments: [240, 1620, 1860, 2940, 4020, 5850, 6150, 6480],
    rights: "Charade (1963). Wikimedia Commons marks the film public domain in the United States because the original release lacked a valid copyright notice. Local clips omit audio; verify the source and territory before public distribution.",
  }),
  film("cameramans-revenge", "The Cameraman's Revenge", "Deadpan insect stop motion", ["Beetle hearth", "Camera close-up", "Crimson theater", "Keyhole tableau", "Studio camera", "Interior ambush", "Projection keyhole", "Bug film set"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:Ladislas_Starevich_-_The_Cameraman%27s_Revenge.webm", sourceMediaUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Ladislas_Starevich_-_The_Cameraman%27s_Revenge.webm", moments: [26, 106, 166, 266, 366, 546, 686, 726],
    rights: "The Cameraman's Revenge (1912). Wikimedia Commons marks the source public domain. Local clips omit audio and avoid titles.",
  }),
  film("the-lodger", "The Lodger", "Rain-soaked Hitchcock suspense", ["Newsroom window", "Dancers recoil", "Staircase vigil", "Clock tower", "Restless sleep", "Landing encounter", "Police conference", "Tense close-up"], {
    availability: "ready", archiveId: "the-lodger-a-story-of-the-london-fog-1927-bd-mkv", preferredFile: "The Lodger A Story of the London Fog (1927) {tmdb-2760} - [Remux-1080p][DTS-HD MA 2.0][AVC]-ESiR.mp4", sourcePage: "https://archive.org/details/the-lodger-a-story-of-the-london-fog-1927-bd-mkv", moments: [283, 509, 1187, 1978, 2317, 3221, 3673, 3899],
    rights: "The Lodger (1927). Underlying film is public domain in the United States; the Internet Archive item carries a Public Domain Mark. Local clips omit audio and avoid intertitles.",
  }),
  film("underworld", "Underworld", "Expressionist gangster noir", ["Bedside reckoning", "Gangster close-up", "Tenement stairs", "Feathered stare", "Nightclub ribbons", "Dance-floor struggle", "Prison bars", "Last gathering"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:Underworld_(1927).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/Underworld_%281927%29.webm/Underworld_%281927%29.webm.480p.vp9.webm", moments: [150, 750, 1150, 1650, 1950, 2550, 3750, 4550],
    rights: "Underworld (1927). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid intertitles.",
  }),
  film("docks-of-new-york", "The Docks of New York", "Steamy waterfront melodrama", ["Steam-room worker", "Dockside crowd", "Tavern machinery", "Rigging silhouette", "Waterfront room", "Backlit couple", "Barrel-lined dock", "Grand saloon"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:The_Docks_of_New_York_(1928).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/75/The_Docks_of_New_York_%281928%29.webm/The_Docks_of_New_York_%281928%29.webm.480p.vp9.webm", moments: [141, 310, 517, 611, 1175, 1741, 2300, 4268],
    rights: "The Docks of New York (1928). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid intertitles.",
  }),
  film("haxan", "Häxan", "Occult documentary phantasmagoria", ["Witch's table", "Blue apparition", "Possessed close-up", "Sickbed vision", "Ritual chamber", "Moonlit coven", "Nun's nightmare", "Devil visitation"], {
    availability: "ready", archiveId: "haxan_1922", preferredFile: "haxan_1922.mp4", sourcePage: "https://archive.org/details/haxan_1922", moments: [865, 1530, 1796, 2460, 2860, 3259, 4988, 5786],
    rights: "Häxan (1922). Underlying film is public domain in the United States; this Internet Archive scan is used without its audio and local clips avoid intertitles.",
  }),
  film("nosferatu", "Nosferatu", "German expressionist vampire horror", ["Orlok doorway", "Coffin rising", "Ghost ship", "Ship at harbor", "Plague ship docks", "Orlok at the window", "Shadow staircase", "Sunrise death"], { availability: "ready", archiveId: "Nosferatu1922", preferredFile: "Nosferatu-smaller2.mp4", sourcePage: "https://archive.org/details/Nosferatu1922", moments: [2003, 2270, 3565, 3795, 4170, 5084, 5208, 5306] }),
  film("cat-and-canary", "The Cat and the Canary", "Haunted-house comedy horror", ["Mansion mechanism", "Testament close-up", "Headlamp arrival", "Bedstead shadows", "Blue staircase", "Dining-room tension", "Endless corridor", "Night pursuit"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:The_Cat_and_the_Canary_(1927).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/9/96/The_Cat_and_the_Canary_%281927%29.webm", moments: [271, 491, 821, 1701, 2581, 2691, 3791, 4671],
    rights: "The Cat and the Canary (1927). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid intertitles.",
  }),
  film("usher", "The Fall of the House of Usher", "Avant-garde architectural horror", ["Angular supper", "Castle silhouette", "Impossible chamber", "Dark geometry", "Blade of light", "Grasping hands", "Shadow corridor", "Diagonal lattice"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:The_Fall_of_the_House_of_Usher_(1928).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/1/19/The_Fall_of_the_House_of_Usher_%281928%29.webm", moments: [106, 66, 206, 246, 326, 386, 546, 706],
    rights: "The Fall of the House of Usher (1928). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid opening titles.",
  }),
  film("aelita", "Aelita: Queen of Mars", "Constructivist Martian spectacle", ["Martian telescope", "Angular headdress", "Radiant energy tower", "Revolutionary parade", "Storm transmission", "Martian vision", "Staircase uprising", "Martian crowd"], { availability: "ready", archiveId: "aelita-queen-of-mars-1924_202506", preferredFile: "Aelita Queen of Mars (1924).mp4", sourcePage: "https://archive.org/details/aelita-queen-of-mars-1924_202506", moments: [330, 5365, 2700, 4810, 5100, 5400, 5550, 6000] }),
  film("woman-in-moon", "Woman in the Moon", "Silent-era lunar engineering", ["Rocket gantry", "Engine cradle", "Launch rails", "Rocket in flight", "Zero-gravity cabin", "Moon through glass", "Cabin ladder", "Lunar canyon"], {
    availability: "ready", archiveId: "WomanInTheMoon", preferredFile: "zzWomanMoon.mp4", sourcePage: "https://archive.org/details/WomanInTheMoon", moments: [5261, 5447, 5509, 5881, 6067, 6687, 7679, 8237],
    rights: "Woman in the Moon (1929). The underlying film is public domain in the United States. This Internet Archive scan has no explicit item license; local clips omit audio and intertitles, and the exact scan should be rechecked before distribution.",
  }),
  film("crazy-ray", "Paris qui dort / The Crazy Ray", "Time-frozen Paris surrealism", ["Eiffel ironwork", "Frozen street", "Frozen statue", "Stopped motorcar", "Endless banquet", "Tower descent", "Frozen brawl", "Ray machine"], { availability: "ready", archiveId: "silent-paris-qui-dort-aka-paris-asleep", preferredFile: "Paris qui dort AKA Paris Asleep.mp4", sourcePage: "https://archive.org/details/silent-paris-qui-dort-aka-paris-asleep", moments: [180, 300, 540, 660, 900, 1140, 1500, 1980] }),
  film("mechanical-man", "The Mechanical Man", "Italian robot rampage", ["Scarlet mechanism", "Operating table", "Blue machine", "Masked gathering", "Ballroom panic", "Iron-bar attack", "Woman close-up", "Arena crowd"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:L%27uomo_meccanico_(1921).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/a/a9/L%27uomo_meccanico_%281921%29.webm", moments: [108, 176, 256, 376, 696, 936, 1180, 1136],
    rights: "L'uomo meccanico / The Mechanical Man (1921). Wikimedia Commons marks the source public domain. Local clips omit audio and avoid intertitles.",
  }),
  film("iron-horse", "The Iron Horse", "Epic railroad western", ["Riders on the plain", "Forest locomotive", "Buffalo charge", "Riders on freight", "Track-laying crew", "Steam on the rails", "Crowded work train", "Final track push"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:The_Iron_Horse_(1924).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/5/57/The_Iron_Horse_%281924%29.webm/The_Iron_Horse_%281924%29.webm.480p.vp9.webm", moments: [651, 1581, 1953, 2139, 3800, 6789, 7905, 8463],
    rights: "The Iron Horse (1924). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid intertitles.",
  }),
  film("three-bad-men", "3 Bad Men", "Kinetic silent western", ["Open-range riders", "Rider silhouettes", "Wagon sprint", "Trading post", "Tent-camp tension", "Railroad platform", "Mounted posse", "Canyon riders"], {
    availability: "ready", sourcePage: "https://commons.wikimedia.org/wiki/File:3_Bad_Men_(1926).webm", sourceMediaUrl: "https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b8/3_Bad_Men_%281926%29.webm/3_Bad_Men_%281926%29.webm.480p.vp9.webm", moments: [515, 633, 978, 1323, 2358, 2703, 3393, 4773],
    rights: "3 Bad Men (1926). Wikimedia Commons marks the source public domain in the United States. Local clips omit audio and avoid intertitles.",
  }),
  film("movie-camera", "Man with a Movie Camera", "Soviet city symphony montage", ["Camera awakens", "Machine rhythm", "Factory pistons", "Crowd faces", "Split-screen city", "Daily montage", "Camera operator", "Kino finale"], { availability: "ready", archiveId: "man-with-a-movie-camera", preferredFile: "Man with a Movie Camera.mp4", sourcePage: "https://archive.org/details/man-with-a-movie-camera", moments: [170, 518, 1050, 1510, 2190, 2810, 3350, 3950] }),
  film("ballet-mecanique", "Ballet mécanique", "Dada machine rhythm", ["Disembodied smile", "Chrome spheres", "Machine teeth", "Triangle pulse", "Stomping figure", "Prism face", "Face and circle", "Dancing legs"], {
    availability: "ready", archiveId: "BalletMcanique", preferredFile: "Ballet mécanique.mp4", sourcePage: "https://archive.org/details/BalletMcanique", moments: [46, 76, 146, 286, 406, 466, 526, 566],
    rights: "Ballet mécanique (1924). The underlying film is public domain in the United States; the Internet Archive item has no explicit file license. Local clips omit audio, titles, and edition credits.",
  }),

  film("fantastic-planet", "Fantastic Planet", "Surreal psychedelic cutout science fiction", ["Blue giant gaze", "Tiny humans run", "Meditation orbit", "Crystal landscape", "Creature encounter", "Abstract machine", "Floating statues", "Planet ritual"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source.", fit: "cover" }),
  film("good-bad-ugly", "The Good, the Bad and the Ugly", "Operatic widescreen western", ["Desert widescreen", "Three-way stare", "Horse charge", "Cannon smoke", "Boots and dust", "Bridge explosion", "Cemetery orbit", "Final showdown"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source." }),
  film("barbarella", "Barbarella", "Pop-art space camp", ["Zero-gravity drift", "Fur spaceship", "Plastic city", "Angel flight", "Bubble chamber", "Retro control room", "Cosmic color wash", "Camp finale"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source.", fit: "cover" }),
  film("mad-max", "Mad Max", "Dusty kinetic road apocalypse", ["Road horizon", "Engine close-up", "Convoy charge", "Mirror glare", "Crash geometry", "Leather silhouettes", "Dust vortex", "Highway vanishing point"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source.", fit: "cover" }),
  film("popeye-cartoons", "Popeye Cartoons", "Elastic nautical cartoon slapstick", ["Spinach charge", "Sailor swagger", "Harbor bounce", "Fist whirlwind", "Ship dance", "Villain tumble", "Ocean rubber hose", "Victory pose"], { group: "Mixed-rights source needed", rights: "Only specifically verified public-domain cartoons should be used; later Popeye animation remains copyrighted." }),
  film("city-of-lost-children", "The City of Lost Children", "Rusty storybook steampunk", ["Harbor fog", "Cyclops march", "Green laboratory", "Diving suit", "Dream machine", "Carnival nightmare", "Mechanical flea", "Red-lit escape"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source.", fit: "cover" }),
  film("spirited-away", "Spirited Away", "Luminous hand-drawn spirit world", ["Train on water", "Bathhouse glow", "Spirit procession", "Paper birds", "Dragon flight", "Food transformation", "Boiler room", "Tunnel return"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source.", fit: "cover" }),
  film("raging-bull", "Raging Bull", "High-contrast boxing fever dream", ["Ring smoke", "Rope close-up", "Slow-motion punch", "Flashbulb storm", "Corner ritual", "Crowd blur", "Water spray", "Empty ring"], { group: "Copyrighted source needed", rights: "Copyrighted wishlist title; provide a lawfully obtained local source." }),
];

export const PLAYABLE_SCENE_IDS = SCENE_CATALOG
  .filter((scene) => scene.availability === "ready")
  .map((scene) => scene.id);
