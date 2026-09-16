# Test asset provenance

## Public-source performance clips

`scripts/fetch-archive-scene.mjs` reads Archive metadata or a configured direct institutional source, seeks into the selected file, and saves only the eight-second local performance excerpts. This avoids storing full films and removes network playback from the live path.

All 28 playable scenes contain twelve independent, silent performance excerpts. Clips 9–12 were selected from source moments separate from the original eight and reviewed at three points per excerpt to remove title/dialogue cards. `--start=N` can rebuild only a newly added range, while `--cache-sources=PATH` caches a remote source outside the project when repeated HTTP range-seeks would be unreliable.

| Scene | Source item | Local clips | Rights note |
| --- | --- | ---: | --- |
| Gumby Clay Trip | [Cartoon Craze: Gumby Gumbasia](https://archive.org/details/gumby-02) | 8 | Item does not state a license; selected for this private POC at the user's request. Verify before distribution. |
| Swing You Sinners! | [1930 cartoon](https://archive.org/details/1930_Swing_You_Sinners) | 8 | Item is marked Public Domain. |
| Fiddlesticks | [1930 Ub Iwerks cartoon](https://archive.org/details/Fiddlesticks1930UbIwerks) | 8 | Item is marked Public Domain. |
| The Skeleton Dance | [1929 HD copy](https://archive.org/details/the-skeleton-dance-1929-hd) | 8 | Item is marked Public Domain. |
| The Adventures of Prince Achmed | [public-domain-marked 1080p copy](https://archive.org/details/the-adventures-of-prince-achmed-1926-by-carl-koch) | 8 | Full near-4:3 tinted frame; audio omitted. The upload is Blu-ray-derived, so verify restoration rights before distribution or public performance. |
| A Trip to the Moon | [public-domain-marked 1080p scan](https://commons.wikimedia.org/wiki/File:Le_Voyage_dans_la_Lune_(1902).webm) | 8 | Wikimedia identifies the file as free of known restrictions. Silent black-and-white scan; modern color restoration and AIR score are not used. |
| The Cameraman's Revenge | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:Ladislas_Starevich_-_The_Cameraman%27s_Revenge.webm) | 8 | Audio and titles omitted from the local stop-motion excerpts. |
| The Lodger | [Internet Archive copy](https://archive.org/details/the-lodger-a-story-of-the-london-fog-1927-bd-mkv) | 8 | Item carries a Public Domain Mark; local clips omit audio and intertitles. Verify restoration rights before distribution. |
| Underworld | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:Underworld_(1927).webm) | 8 | Local clips omit audio and intertitles. |
| The Docks of New York | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:The_Docks_of_New_York_(1928).webm) | 8 | Local clips omit audio and intertitles. |
| Häxan | [Internet Archive copy](https://archive.org/details/haxan_1922) | 8 | Underlying film is public domain in the U.S.; local clips omit audio and intertitles. Verify the scan before distribution. |
| The Cat and the Canary | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:The_Cat_and_the_Canary_(1927).webm) | 8 | Local clips omit audio and intertitles. |
| The Fall of the House of Usher | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:The_Fall_of_the_House_of_Usher_(1928).webm) | 8 | Local clips omit audio and opening titles. |
| Woman in the Moon | [Internet Archive copy](https://archive.org/details/WomanInTheMoon) | 8 | Underlying film is public domain in the U.S.; the item has no explicit file license. Local clips omit audio and intertitles. |
| The Mechanical Man | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:L%27uomo_meccanico_(1921).webm) | 8 | Local clips omit audio and intertitles. |
| The Iron Horse | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:The_Iron_Horse_(1924).webm) | 8 | Local clips omit audio and intertitles. |
| 3 Bad Men | [Commons public-domain copy](https://commons.wikimedia.org/wiki/File:3_Bad_Men_(1926).webm) | 8 | Local clips omit audio and intertitles. |
| Ballet mécanique | [Internet Archive copy](https://archive.org/details/BalletMcanique) | 8 | Underlying film is public domain in the U.S.; the item has no explicit file license. Local clips omit audio, titles, and edition credits. |
| King of Jazz | [1930 Commons copy](https://commons.wikimedia.org/wiki/File:King_of_Jazz_(1930).webm) | 8 | Wikimedia marks the original film public domain in the U.S. Local clips omit audio; verify the digital edition and territory before distribution. |
| Whoopee! | [1930 Commons copy](https://commons.wikimedia.org/wiki/File:Whoopee!_(1930).webm) | 8 | Wikimedia marks the film public domain in the U.S. Local clips omit audio and avoid the source's most objectionable period-stereotype sequences. |
| Gulliver's Travels | [1939 Commons copy](https://commons.wikimedia.org/wiki/File:Gulliver%27s_Travels_(1939).webm) | 8 | Wikimedia identifies the U.S. film copyright as not renewed. Local clips omit audio; other territories may differ. |
| Nothing Sacred | [1937 Commons copy](https://commons.wikimedia.org/wiki/File:Nothing_Sacred_(1937)_by_William_A._Wellman.webm) | 8 | Wikimedia marks the film public domain in the U.S. because its copyright was not renewed. Local clips omit audio. |
| Charade | [1963 Commons copy](https://commons.wikimedia.org/wiki/File:Charade_(1963).webm) | 8 | Wikimedia marks the film public domain in the U.S. because the original release lacked a valid copyright notice. Local clips omit audio. |
| Nosferatu | [1922 copy](https://archive.org/details/Nosferatu1922) | 8 | Source-work candidate is public domain in the U.S.; verify edition/score. |
| Aelita: Queen of Mars | [1924 copy](https://archive.org/details/aelita-queen-of-mars-1924_202506) | 8 | Item is marked Public Domain. |
| Paris qui dort / The Crazy Ray | [silent copy](https://archive.org/details/silent-paris-qui-dort-aka-paris-asleep) | 8 | Verify the particular scan and score before distribution. |
| Man with a Movie Camera | [1929 copy](https://archive.org/details/man-with-a-movie-camera) | 8 | Item is marked Public Domain. |

## Metropolis Machine

Source file: [*Metropolis* (1927, English titles 1930s), Wikimedia/Wikisource](https://en.wikisource.org/wiki/File:Metropolis_(1927,_English_titles_1930s).webm).

The source page identifies this version as public domain in the United States. The POC contains twelve silent, independently transcoded eight-second excerpts and no later restoration score. The eight added cuts use clean moving-image passages around 00:02:30, 00:05:05, 00:11:32, 00:34:48, 00:45:17, 01:16:52, 01:35:30, and 01:51:02; title and dialogue cards were excluded. Public-domain status varies by country, and later restorations, scores, and editions may have separate rights. Re-check rights before distribution outside a private U.S. proof of concept.

## Excluded source

*Seven Samurai* (1954) is not included. Its age and cultural prominence do not make it public domain; footage should be used only with a suitable license.
