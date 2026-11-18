# 30 Days of Adventure

A small text adventure game that runs in the browser.

## Rules

- Start: 100 life (max life 100), 10 defense, 200 coins, 0 EXP.
- To start each new day you must answer a random question correctly (`questions.csv`, multiple choice with 4 options in random order). A wrong answer shows the correct one and gives you a different question to try.
- Penalty for wrong answers in a row (reset by a correct answer): 1 wrong, no penalty; 2 in a row, lose 10 coins; 3 in a row, lose 10 more life (not reduced by defense); 4 in a row, game over.
- Each new day triggers a random event (`event.csv`). Its values are changes (plus or minus); `full` means life is fully restored; a blank counts as 0. An event is resolved in this order:
  1. Life: a negative value has your defense added to it, and that is the final damage (down to 0 at most, it never turns into healing). For example, -20 with 10 defense is -10. Healing never goes above the current max life.
  2. Coins can go negative (debt); EXP only goes up.
  3. Max life (`maxlife`): at full life you stay at full life after the change; otherwise there is no healing, and life is only lowered if it is above the new max (90/100 with max +10 becomes 90/110; max -15 becomes 85/85).
  4. Defense (`defense`): goes up or down, never below 0.
  - `life`, `coins`, `maxlife` and `defense` also accept `set N` (for example `set 10`): the value becomes N only if it is currently greater than N, otherwise it stays the same (it never heals you or gives you coins). A life set is not reduced by defense; a max life set adjusts life using rule 3 above. EXP does not support set.
- Shop: buy at any time with coins. Defense +5 / +10 / +15 costs 100 / 180 / 270 coins; life +10 / +20 / +30 costs 100 / 180 / 270 coins. You can only buy while life is above 0, and you need enough coins (no buying on debt). Bought life never goes above max life, and you cannot buy life at full life.
- At 0 life you lose; survive all 30 days with life above 0 and you win. Winning or losing shows a popup that you close yourself or dismiss with "Play Again".

## Importing a question set

- Click "📋 Question format" at the top of the page to see the format and download a blank template.
- Click "📂 Import questions" to pick your own CSV file. The imported set replaces the default one from the next question on. Reloading the page restores the default `questions.csv`.
- Format: one question per row, 5 columns `Question,Answer,Distractor1,Distractor2,Distractor3`; the header row is optional; UTF-8 and GBK encodings both work, so you can save straight from Excel or Google Sheets as CSV.

## Data files

- `questions.csv`: `Question,Answer,Distractor1,Distractor2,Distractor3`
- `event.csv`: `SN,event,life,coins,exp,defense,maxlife`

## Background music

- From https://opengameart.org/content/new-sunrise （CC0 Public Domain）
- The music tries to start automatically when the page opens. Most browsers block autoplay with sound; in that case it starts on the first interaction of any kind (click, touch or key press). The button in the top right turns music on or off.
