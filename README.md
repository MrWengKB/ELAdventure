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
  - They also accept `double` or `half` (halving rounds odd numbers up). Doubled life never goes above max life, and halving life is not reduced by defense; when max life is doubled or halved, life follows rule 3 above; defense is simply doubled or halved. When defense is 0, `double` counts as +30; when coins are 0, `double` counts as +100. When coins are negative, `double` counts as `nodebt` and `half` has no effect.
  - `coins` also accepts `nodebt`: negative coins become 0 (debt cleared); otherwise it counts as +30.
- Shop: buy at any time with coins. Defense +5 / +10 / +15 costs 100 / 180 / 270 coins; life +10 / +20 / +30 costs 100 / 180 / 270 coins. You can only buy while life is above 0, and you need enough coins (no buying on debt). Bought life never goes above max life, and you cannot buy life at full life.
- At 0 life you lose; survive all 30 days with life above 0 and you win. Winning or losing shows a popup that you close yourself or dismiss with "Play Again".
- Event chains: the `next` column in `event.csv` holds the SN of a follow-up event. After this event happens, the follow-up event always happens the next day; 0 means no follow-up and the next day is random as usual. The `prev` column holds the SN of the event before it: 0 means the event can be drawn at random; any other value means it only happens through a chain and is never drawn on its own (the same goes for events that another event's `next` points to). For example, with 32 → 33 and 33 → 34 (33 has prev 32, 34 has prev 33), the events happen in the order 32, 33, 34.

## Importing a question set

- Click "📋 Question format" at the top of the page to see the format and download a blank template.
- Click "📂 Import questions" to pick your own CSV file. The imported set replaces the default one from the next question on. Reloading the page restores the default `questions.csv`.
- Format: one question per row, 5 columns `Question,Answer,Distractor1,Distractor2,Distractor3`; the header row is optional; UTF-8 and GBK encodings both work, so you can save straight from Excel or Google Sheets as CSV.

## Publishing homework (no scores recorded)

- Choose the question set first (the default one, or your own CSV via "📂 Import questions"), click "📤 Publish homework", enter a title and click "Create homework link".
- You get a link and a QR code: copy the link, or download / print the QR code. Students scan it with a tablet or phone.
- Students play with exactly that question set. The homework title is shown at the top, and the format / import / publish buttons are hidden, so they cannot change the questions.
- No server, Google Sheet or Apps Script is needed: the questions are compressed into the link after `#hw=`. No names or scores are recorded.
- When you publish the default set, the link only says "use the default questions", so it stays short; if you later edit `questions.csv`, old links use the new questions too.
- A QR code has limited room: about 30 Chinese questions or about 50 short English questions. With more, the link still works but there is no QR code.

## Data files

- `questions.csv`: `Question,Answer,Distractor1,Distractor2,Distractor3`
- `event.csv`: `SN,event,life,coins,exp,defense,maxlife,prev,next`

## Background music

- From https://opengameart.org/content/new-sunrise （CC0 Public Domain）
- The music tries to start automatically when the page opens. Most browsers block autoplay with sound; in that case it starts on the first interaction of any kind (click, touch or key press). The button in the top right turns music on or off.
