# Quiz Party — multiplayer quiz game

A mobile-friendly live quiz for up to 30 players per room. One Node.js process serves the site and synchronizes games with Socket.IO.

## Run locally

1. Install Node.js 20 or newer from https://nodejs.org/
2. In this folder run `npm install`
3. Run `npm start`
4. Open http://localhost:3000
5. Host creates questions and a room. Other players join using the same address (when hosted online) and game PIN.

## Deploy to Render

1. Create a new GitHub repository at https://github.com/new
2. Upload the **contents** of this folder (`server.js`, `package.json`, and the `public` folder) to the repository.
3. Sign in at https://dashboard.render.com/ and choose **New > Web Service**.
4. Connect your GitHub repository.
5. Select **Node**, build command `npm install`, start command `npm start`.
6. Choose a plan, create the service, and wait for deployment.
7. Open the generated `https://...onrender.com` URL. Create a quiz and share the join link or PIN.

**Important:** Rooms and scores are in server memory. They disappear if the server restarts or host disconnects. Questions are stored only in the host browser's local storage. For best results, keep one Render instance running and do not deploy updates during a game. Free hosting plans may sleep or have availability limits. Use an always-on plan for live events.

## Notes

- Up to 30 players per game; 1–50 questions.
- Correct answers award 500–1000 points depending on speed.
- The host sees the question and can reveal results early.
- Players can reconnect during a game using their existing browser session.
- Anyone who has the host's browser can control that host session; there are no user accounts.
- Basic room controls are server-side; this is a starter project, not a hardened public competition service.
- The game uses a single Node.js process. Do not enable multiple instances without adding a shared room store and Socket.IO adapter.
