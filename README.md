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

- From https://opengameart.org/content/new-sunrise （CC0 Public Domain）
