const express = require('express')
const request = require('request');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini SDK

const port = 5000

global.access_token = ''

dotenv.config()

var spotify_client_id = process.env.SPOTIFY_CLIENT_ID
var spotify_client_secret = process.env.SPOTIFY_CLIENT_SECRET
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Load Gemini API Key

// Initialize Gemini AI Client (do this once)
let genAI;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
} else {
  console.warn('GEMINI_API_KEY not found in .env file. Gemini functionality will be disabled.');
}

var spotify_redirect_uri = 'http://127.0.0.1:3000/auth/callback'

// Helper function to make promisified Spotify API requests
function spotifyApiRequest(options) {
  return new Promise((resolve, reject) => {
    request.get(options, (error, response, body) => {
      if (error) {
        return reject(error);
      }
      // Check if body is a string and try to parse if it looks like JSON
      let parsedBody = body;
      if (typeof body === 'string') {
        try {
          parsedBody = JSON.parse(body);
        } catch (e) {
          // Ignore parsing error if it's not JSON
        }
      }
      
      if (response.statusCode !== 200) {
        // Include response body for more context on API errors
        return reject({ statusCode: response.statusCode, body: parsedBody || body });
      }
      resolve(parsedBody);
    });
  });
}

var generateRandomString = function (length) {
  var text = '';
  var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (var i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

var app = express();

app.get('/auth/login', (req, res) => {

  var scope = "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private user-library-read"
  var state = generateRandomString(16);

  var auth_query_parameters = new URLSearchParams({
    response_type: "code",
    client_id: spotify_client_id,
    scope: scope,
    redirect_uri: spotify_redirect_uri,
    state: state
  })

  res.redirect('https://accounts.spotify.com/authorize/?' + auth_query_parameters.toString());
})

app.get('/auth/callback', (req, res) => {

  var code = req.query.code;

  var authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      code: code,
      redirect_uri: spotify_redirect_uri,
      grant_type: 'authorization_code'
    },
    headers: {
      'Authorization': 'Basic ' + (Buffer.from(spotify_client_id + ':' + spotify_client_secret).toString('base64')),
      'Content-Type' : 'application/x-www-form-urlencoded'
    },
    json: true
  };

  request.post(authOptions, function(error, response, body) {
    if (!error && response.statusCode === 200) {
      access_token = body.access_token;
      res.redirect('/')
    }
  });

})

app.get('/auth/token', (req, res) => {
  res.json({ access_token: access_token})
})

app.get('/api/playlists', async (req, res) => {
  console.log('Accessing /api/playlists');
  if (!global.access_token) {
    console.error('No access token found in /api/playlists');
    return res.status(401).json({ error: 'User not authenticated' });
  }

  console.log('Using access_token (first 10 chars):', global.access_token.substring(0, 10));

  try {
    console.log('Attempting to fetch user playlists metadata...');
    const playlistsData = await spotifyApiRequest({
      url: 'https://api.spotify.com/v1/me/playlists?limit=20&fields=items(id,name,href,images)',
      headers: { 'Authorization': 'Bearer ' + global.access_token },
      json: true 
    });
    console.log('Successfully fetched user playlists metadata.');

    const playlists = playlistsData.items || [];
    if (playlists.length === 0) {
      console.log('No playlists found for the user.');
      return res.json([]);
    }

    // No longer fetching tracks or audio features here for all playlists
    // Just return the playlist metadata
    res.json(playlists);

  } catch (error) {
    console.error('Error fetching user playlists metadata:', error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: 'Failed to fetch playlist metadata', details: error.body || error.message });
  }
});

// New endpoint to analyze tracks with Gemini
app.post('/api/analyze-tracks-with-gemini', express.json(), async (req, res) => {
  console.log('Accessing /api/analyze-tracks-with-gemini');
  const tracks = req.body.tracks; // Expect an array of track objects

  if (!genAI) {
    return res.status(500).json({ error: 'Gemini AI client not initialized. Check API key.' });
  }

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'No tracks provided for analysis.' });
  }

  // Prepare the data for the prompt
  // We need to send a string representation of the tracks that Gemini can understand.
  // For example, a summary of each track: name, artists, maybe some key features if we had them.
  // Since we don't have audio features anymore, we will send name, artists, album name, duration, popularity.
  
  const trackInfoForPrompt = tracks.map((track, index) => (
    `${index + 1}. Song Title: ${track.name}, Artists: ${track.artists.map(a => a.name).join(', ')}, Album: ${track.album ? track.album.name : 'N/A'}, Duration: ${Math.round(track.duration_ms / 1000)}s, Popularity: ${track.popularity}, Spotify Track ID: ${track.id}`
  )).join('\n');

  const numberOfSongs = tracks.length;
  const numberOfCommentaries = numberOfSongs > 1 ? numberOfSongs - 1 : 0;

  const prompt = `You are an AI radio host. You will be given a list of ${numberOfSongs} songs, each numbered and including its Spotify Track ID. Your task is to meticulously follow these instructions:

1.  **Song Segments (Exactly ${numberOfSongs} segments):**
    For **EACH** of the ${numberOfSongs} songs provided (from song 1 to song ${numberOfSongs}), you MUST identify its most impactful and representative segment.
    - This segment should ideally be more than 90 seconds long (e.g., 90-120 seconds, or longer if appropriate for the song structure).
    - Provide this as "best_segment_start_seconds" and "best_segment_end_seconds".
    - If a specific long segment cannot be confidently identified, suggest a substantial segment like 0 to 90 seconds, or the full track if it's very short.
    - **Crucially, you MUST generate one segment object for EACH of the ${numberOfSongs} songs.**

2.  **Radio Commentary (Exactly ${numberOfCommentaries} segments):**
    You MUST generate engaging radio host commentary to be played **between each song**.
    - Since there are ${numberOfSongs} songs, you MUST generate exactly ${numberOfCommentaries} commentary segments.
    - Each commentary segment should be concise, around 15-30 seconds long.
    - Commentary should include fun facts, music trivia, artist information, or themes connecting the songs, matching the energy and mood of the music.

Here is the list of ${numberOfSongs} songs:
${trackInfoForPrompt}

**Output Format (Strict JSON Adherence):**
You MUST return your response as a **single, valid JSON object** and NOTHING ELSE. Do not include any introductory text, explanations, or markdown backticks (\`\`\`json ... \`\`\`) around the JSON object.

The JSON object must have two main keys: "song_segments" and "radio_commentary".

-   **"song_segments" key:**
    -   The value MUST be an array of **exactly ${numberOfSongs} JSON objects**.
    -   Each object in this array corresponds to one of the input songs, in the same order.
    -   Each object MUST contain these keys:
        -   "track_id": The **exact Spotify Track ID** that was provided with the input song. (e.g., if song 1 had ID "xyz", the first segment object must have "track_id": "xyz").
        -   "track_name": The original song title from the input.
        -   "best_segment_start_seconds": Numerical value.
        -   "best_segment_end_seconds": Numerical value.

-   **"radio_commentary" key:**
    -   The value MUST be an array of **exactly ${numberOfCommentaries} JSON objects** (unless there was only 1 song, in which case this array will be empty or not present, though an empty array is preferred for consistency).
    -   Each object in this array MUST contain these keys:
        -   "insert_after_track_index": A 0-indexed numerical value. This indicates which song segment (from your "song_segments" array) this commentary should follow.
            -   Commentary after song 1 (the first song) uses "insert_after_track_index": 0.
            -   Commentary after song 2 (the second song) uses "insert_after_track_index": 1.
            -   ...and so on. The last commentary will be after song ${numberOfSongs > 1 ? numberOfSongs - 1 : 0} (if ${numberOfSongs} > 1) and will have "insert_after_track_index": ${numberOfCommentaries > 0 ? numberOfCommentaries - 1 : 0}.
        -   "commentary_text": String value.

Example for 2 songs (meaning 1 commentary segment):
{
  "song_segments": [
    { "track_id": "provided_spotify_id_for_song_1", "track_name": "Song Title 1", "best_segment_start_seconds": 30, "best_segment_end_seconds": 120 },
    { "track_id": "provided_spotify_id_for_song_2", "track_name": "Song Title 2", "best_segment_start_seconds": 0, "best_segment_end_seconds": 90 }
  ],
  "radio_commentary": [
    { "insert_after_track_index": 0, "commentary_text": "That was Song Title 1! Now for Song Title 2..." }
  ]
}

**Ensure your entire response is ONLY this JSON object.**
`;

  try {
    console.log('Sending request to Gemini API...');
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash"}); // Corrected Gemini model
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Received response from Gemini API.');
    
    // Clean the text if it's wrapped in markdown JSON block
    let cleanedText = text.trim();
    if (cleanedText.startsWith("```json")) {
      cleanedText = cleanedText.substring(7); // Remove ```json
      if (cleanedText.endsWith("```")) {
        cleanedText = cleanedText.substring(0, cleanedText.length - 3); // Remove trailing ```
      }
    }
    cleanedText = cleanedText.trim(); // Trim any extra whitespace

    try {
      const jsonData = JSON.parse(cleanedText); // Parse the cleaned text
      res.json(jsonData);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON:', parseError);
      console.error('Raw Gemini response text:', text);
      res.status(500).json({ error: 'Failed to parse Gemini response as JSON', raw_response: text });
    }

  } catch (error) {
    console.error('Error calling Gemini API:', error);
    res.status(500).json({ error: 'Failed to get analysis from Gemini API', details: error.message });
  }
});

// New endpoint to fetch tracks for a specific playlist
app.get('/api/playlist-tracks/:playlistId', async (req, res) => {
  const { playlistId } = req.params;
  console.log(`Accessing /api/playlist-tracks for playlist ID: ${playlistId}`);

  if (!global.access_token) {
    console.error('No access token found for /api/playlist-tracks');
    return res.status(401).json({ error: 'User not authenticated' });
  }
  console.log('Using access_token (first 10 chars):', global.access_token.substring(0, 10));

  try {
    const tracksData = await spotifyApiRequest({
      url: `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=10&fields=items(track(id,name,artists(name),album(name,images),duration_ms,preview_url,popularity))`,
      headers: { 'Authorization': 'Bearer ' + global.access_token },
      json: true
    });
    console.log(`Successfully fetched tracks for playlist ID: ${playlistId}`);

    // Extract just the track objects, filtering out any null items if the API returns them
    const tracks = tracksData.items ? tracksData.items.map(item => item.track).filter(track => track) : [];
    
    // We are not fetching audio features here as per previous decision
    res.json(tracks); // Send back the array of track objects

  } catch (error) {
    console.error(`Error fetching tracks for playlist ID ${playlistId}:`, error);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ error: `Failed to fetch tracks for playlist ${playlistId}`, details: error.body || error.message });
  }
});

app.listen(port, () => {
  console.log(`Listening at http://localhost:${port}`)
})
