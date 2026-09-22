# Euchre Leaderboard App Requirements
## Organization
### Seasonal Organization
- There are four seasons per year, Q1/Q2/Q3/Q4
- Each season starts at the conclusion of the previous season's tournament
- Matches are typically played weekly on Thursdays
- Season tournaments are typically held on Saturdays
- Each season should have its own leaderboard
- Each tournament should have its own results page
- The season leaderboard should include the games from that season's tournament
- There is an overall leaderboard that should include all games played ever

### Player Management
- There should be a player management tab where users can edit active players
- In order for a game to be valid it must contain 3 active players
- Guest games should be labelled with who the guest was
- When a new player gets added to the player list, any games previously played as a guest should be updated to show the player name rather than guest, those games should count toward the new player's record
- For the purposes of the leaderboard, "Guests" are all considered to be one player and all guest game stats should be combined for a guest entry on the leaderboard

### Tournament Setup
- Each tournament should default to 8 players
- Tournaments are split into two parts, a preliminary round robin, and a finals round robin
- Prelim round robin should have every player play with every other player exactly once
- Each player should play against each other player twice whenever possible
- After the preliminary rounds, the top 4 players play a round robin, the next 4 play another round robin, and so on. Any leftover players do not play in the second round
- Both the upper and lower table continue to accrue score, leaderboard at the end of the finals round robin should represent the final results

## Data
### Match Data
- Each match played in league play shall have the following data recorded and input
	- Game score
	- Idiot Points for each player
- Each match played in tournament play shall have the following data recorded and input
	- Game score
	- Sets (euchres) for each team
	- Alone wins for each player
	- Idiot points for  each player

### Leaderboard Metrics
- For each leaderboard (seasonal/overall) the following statistics should be shown and calculated for each player
	- Wins
	- Losses
	- Points For
	- Points Against
	- Point Differential
	- Win %
	- Games behind (calculated as the number of wins required to match current leader's winrate)
	- Points per game
	- +/- Points per game (PPG - League Average PPG)
	- Idiot Points
	- Idiot Points per game
	- +/- Idiot Points per game (IPPG - League Average IPPG)
	- Average point differential
	- Average synergy (not sure what this is, but im trying to migrate a spreadsheet over and this is on there)
	- AVG Expected Point Differential
	- Opponent's Winrate
	- Opponent's Opponent's Winrate
	- Strength of Schedule
	- Strength of Schedule Rank

### Tournament Scoring
- Tournament leaderboard should be updated after each round and should be calculated using the following rules:
	- Every point gained is worth 1 point
	- Every set awards 2 additional points to both players on the team
	- Every alone win awards an additional 4 points to the player who won alone
	- Every match win awards an additional 5 points to both players on the team
	- Every idiot point given subtracts 3 points from that player's score
- Tie breakers for tied tournament points:
	1. Match wins
	2. Loners
	3. Sets
	4. Average Opponent Points per Game

## User Interface
### Color Scheme
- Core colors should be based on Caterpillar Logo Colors
	- FFC500
	- 000000

### Layout
- Page layout should be easily navigable
- Accessible tabs
	- Game History (list of all played games)
	- Game Input (Record who played and what the scores were for a given week of games)
	- Leaderboard (Player list default ordered by winrate)
	- Synergy (Pivot tables showing statistics when playing with each given other player on the leaderboard)
	- Player profile (Shows an individual player's stats)
	- Tournament Results
	- Player Management
	- Tournament Mode (More streamlined view for running tournaments that shows current matchups and allows for easy live scoring)

## Security
- For now, anyone can access and edit any data
