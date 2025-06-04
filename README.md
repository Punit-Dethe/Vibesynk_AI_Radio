# Vibesynk AI Radio

Vibesynk AI Radio is an innovative web application that transforms your Spotify listening experience into an AI-powered radio show. It intelligently selects song segments, generates radio host commentary using Google Gemini, and delivers it all through a dynamic interface with Text-to-Speech.

## Core Features

*   **Spotify Integration:** Securely authenticates with your Spotify account to access playlists and control playback.
*   **AI-Powered Song Analysis:** Uses Google Gemini to analyze tracks and identify the most impactful 30-90 second segments.
*   **Dynamic Radio Commentary:** Gemini generates engaging commentary, fun facts, and trivia to be spoken between songs.
*   **Text-to-Speech (TTS):** Leverages the browser's Web Speech API to voice the AI-generated commentary.
*   **Intelligent Playback:** Plays the identified song segments, seamlessly transitioning between music and commentary.
*   **User Interface:** A React-based frontend to display playlists, control playback, and visualize the upcoming queue (future).
*   **Background Music for Commentary:** Plays subtle background music during TTS commentary for a more polished radio feel.

## Tech Stack

*   **Frontend:** React (with basic CSS, planned migration to Tailwind CSS/Vite)
*   **Backend:** Node.js with Express
*   **APIs & SDKs:**
    *   Spotify Web API & Web Playback SDK
    *   Google Gemini API (`@google/generative-ai`)
    *   Web Speech API (for Text-to-Speech)
*   **Audio Manipulation:** Web Audio API (planned for crossfading and mixing)

## Project Flow

1.  **Authentication:** User logs in with their Spotify account.
2.  **Playlist Selection:** User selects a playlist from their Spotify library.
3.  **Track Analysis:**
    *   The selected playlist's tracks are sent to the backend.
    *   The backend queries the Google Gemini API with the track information.
4.  **Gemini Processing:**
    *   Gemini identifies the best 30-90 second segment for each song.
    *   Gemini generates radio host commentary to be inserted between songs.
    *   The analysis and commentary are returned to the frontend in a structured JSON format.
5.  **AI Radio Playback:**
    *   The frontend starts playing the first song's identified segment via the Spotify Web Playback SDK.
    *   When a segment ends, if there's commentary, it's spoken using TTS with background music.
    *   The next song segment then plays, and so on.
6.  **User Interface:**
    *   Displays current playlists and tracks.
    *   Provides playback controls (play, pause, seek).
    *   (Future) Visualizes the upcoming song queue and commentary.

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd vibesynk-ai-radio
    ```

2.  **Spotify Developer App:**
    *   Go to the [Spotify for Developers Dashboard](https://developer.spotify.com/dashboard/).
    *   Create a new application.
    *   Register the following Redirect URI: `http://127.0.0.1:3000/auth/callback`
    *   Note your Client ID and Client Secret.

3.  **Google Gemini API Key:**
    *   Go to [Google AI Studio](https://aistudio.google.com/app/apikey) (or Google Cloud Console) to get your Gemini API key.

4.  **Create `.env` file:**
    In the root folder of the project, create a file named `.env` and add your credentials:
    ```env
    SPOTIFY_CLIENT_ID='your_spotify_client_id'
    SPOTIFY_CLIENT_SECRET='your_spotify_client_secret'
    GEMINI_API_KEY='your_gemini_api_key'
    ```

5.  **Install dependencies:**
    ```bash
    npm install
    ```

6.  **Run the application:**
    Due to a common Node.js crypto issue with newer Node versions (like v22+), you might need to use the `--openssl-legacy-provider` flag:
    ```bash
    npm run dev
    # Or, if you encounter crypto errors:
    # NODE_OPTIONS=--openssl-legacy-provider npm run dev
    ```
    The application will be available at `http://127.0.0.1:3000`.

7.  **Activate Spotify Playback:**
    *   After logging in via the app, you might see "Instance not active."
    *   Open any Spotify app (desktop, web, mobile) and transfer playback to the "Web Playback SDK" device.

## Future Enhancements

*   Transition to Tailwind CSS and Vite for a more modern frontend stack.
*   Implement advanced audio mixing with the Web Audio API (crossfading between songs, commentary, and background music).
*   Develop a more sophisticated queue visualization.
*   Allow interactive user requests for songs or themes.
*   Personalize commentary and song choices based on user listening habits.

## License

This project builds upon the Spotify Web Playback SDK example, which is licensed under the Apache License, Version 2.0. Original license details are preserved.

