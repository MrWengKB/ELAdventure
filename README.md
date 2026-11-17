# Text Adventure

A small text adventure game that runs in the browser.

## Rules

- Start: 10 life (max 10), 200 coins, 0 EXP.
- To start each new day you must answer a random question correctly (`questions.csv`, multiple choice with 4 options in random order). A wrong answer shows the correct one and gives you a different question to try.
- Penalty for wrong answers in a row (reset by a correct answer): 1 wrong, no penalty; 2 in a row, lose 10 coins; 3 in a row, lose 1 more life; 4 in a row, game over.
- Each new day triggers a random event (`event.csv`). Its values are changes (plus or minus); `full` means life is fully restored.
- Life never goes above the max or below 0; coins can go negative (debt); EXP only goes up.
- At 0 life you lose; survive all 30 days with life above 0 and you win. Winning or losing shows a popup that you close yourself or dismiss with "Play Again".

## Data files

- `questions.csv`: `Question,Answer,Distractor1,Distractor2,Distractor3`
- `event.csv`: `SN,event,life,coins,exp`

## Background music

- By default the game plays an original epic score synthesized live in the browser by `js/music.js` (D minor: strings, bass, war drums, brass). It needs no audio file and has no copyright issues.
- Browsers do not allow autoplay, so the music starts on your first click on the page. The button in the top right turns the music on or off, and your choice is remembered.
- To use a real orchestral recording instead, save a licensed track (CC0 recommended, for example from OpenGameArt or Pixabay Music) as `music/bgm.mp3` and the game will loop it automatically. If the track requires attribution (CC-BY), credit the author and link here.

## Running locally

Browsers cannot read the CSV files when `index.html` is opened straight from disk. Run `python3 -m http.server` in the project folder and open http://localhost:8000, or publish it with GitHub Pages.
