import React, { useState, useEffect } from 'react';

// Helper function to generate a random light HSL color
const getRandomLightColor = () => {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 30) + 70; // Saturation between 70-100%
    const l = Math.floor(Math.random() * 20) + 70; // Lightness between 70-90%
    return `hsl(${h}, ${s}%, ${l}%)`;
};

// Constants for background music fade
const FADE_DURATION_MS = 1500; // 1.5 seconds
const BACKGROUND_MUSIC_VOLUME = 0.15; // Target volume for background music (0.0 to 1.0)
const FADE_INTERVAL_MS = 50; // How often to update volume during fade

const track = {
    name: "",
    album: {
        images: [
            { url: "" }
        ]
    },
    artists: [
        { name: "" }
    ]
}

function WebPlayback(props) {

    const [is_paused, setPaused] = useState(false);
    const [is_active, setActive] = useState(false);
    const [player, setPlayer] = useState(undefined);
    const [current_track, setTrack] = useState(track);
    const [device_id, setDeviceId] = useState(null);

    // State for seek bar
    const [track_position, setTrackPosition] = useState(0);
    const [track_duration, setTrackDuration] = useState(0);

    // New state for playlists
    const [playlists, setPlaylists] = useState([]);
    const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
    // const [selectedPlaylistId, setSelectedPlaylistId] = useState(null); // For future use

    // New state for selected playlist's tracks and loading status for tracks
    const [selectedPlaylistId, setSelectedPlaylistId] = useState(null);
    const [selectedPlaylistTracks, setSelectedPlaylistTracks] = useState([]);
    const [isLoadingTracks, setIsLoadingTracks] = useState(false);

    // State for Gemini-driven playback
    const [geminiAnalysis, setGeminiAnalysis] = useState(null);
    const [currentGeminiSongIndex, setCurrentGeminiSongIndex] = useState(0);
    const [isGeminiPlaybackActive, setIsGeminiPlaybackActive] = useState(false);

    // State for Web Speech API TTS
    const [isCommentarySpeaking, setIsCommentarySpeaking] = useState(false);

    // Ref for background music audio element
    const backgroundAudioRef = React.useRef(null);
    // Refs for fade intervals
    const fadeInIntervalRef = React.useRef(null);
    const fadeOutIntervalRef = React.useRef(null);

    useEffect(() => {

        const script = document.createElement("script");
        script.src = "https://sdk.scdn.co/spotify-player.js";
        script.async = true;

        document.body.appendChild(script);

        window.onSpotifyWebPlaybackSDKReady = () => {

            const player = new window.Spotify.Player({
                name: 'Web Playback SDK',
                getOAuthToken: cb => { cb(props.token); },
                volume: 0.5
            });

            setPlayer(player);

            player.addListener('ready', ({ device_id }) => {
                console.log('Ready with Device ID', device_id);
                setDeviceId(device_id);
            });

            player.addListener('not_ready', ({ device_id }) => {
                console.log('Device ID has gone offline', device_id);
            });

            player.addListener('player_state_changed', ( state => {

                if (!state) {
                    return;
                }

                setTrack(state.track_window.current_track);
                setPaused(state.paused);
                setTrackPosition(state.position);
                setTrackDuration(state.duration);

                player.getCurrentState().then( state => { 
                    (!state)? setActive(false) : setActive(true) 
                });

            }));

            player.connect();

        };
    }, [props.token]);

    // Effect for managing the track progress timer
    useEffect(() => {
        let intervalId;
        // Only run the timer if Gemini playback is active AND commentary is NOT speaking
        if (is_active && !is_paused && isGeminiPlaybackActive && !isCommentarySpeaking) { 
            intervalId = setInterval(() => {
                setTrackPosition(prevPosition => {
                    const newPosition = prevPosition + 1000;
                    if (newPosition < track_duration) {
                        if (geminiAnalysis && geminiAnalysis.song_segments[currentGeminiSongIndex]) {
                            const currentSegment = geminiAnalysis.song_segments[currentGeminiSongIndex];
                            if ((newPosition / 1000) >= currentSegment.best_segment_end_seconds) {
                                console.log(`Gemini Playback: Song segment ended for track ${currentSegment.track_name}.`);
                                clearInterval(intervalId); 
                                
                                // Check for commentary for *after* this current song index
                                const commentary = geminiAnalysis.radio_commentary?.find(
                                    c => c.insert_after_track_index === currentGeminiSongIndex
                                );

                                if (commentary && commentary.commentary_text) {
                                    console.log('Playing commentary...');
                                    playCommentary(commentary.commentary_text);
                                } else {
                                    // No commentary, advance to next song segment directly
                                    advanceToNextGeminiSegment();
                                }
                                return newPosition; 
                            }
                        }
                        return newPosition;
                    }
                    return prevPosition;
                });
            }, 1000);
        } else {
            clearInterval(intervalId);
        }

        return () => {
            clearInterval(intervalId);
        };
    }, [is_active, is_paused, track_duration, current_track.uri, isGeminiPlaybackActive, geminiAnalysis, currentGeminiSongIndex, player, isCommentarySpeaking]);

    // useEffect to initiate playback of a new song segment based on Gemini analysis
    useEffect(() => {
        if (isGeminiPlaybackActive && geminiAnalysis && device_id && player) {
            const segments = geminiAnalysis.song_segments;
            if (currentGeminiSongIndex < segments.length) {
                const currentSegment = segments[currentGeminiSongIndex];
                const trackUri = `spotify:track:${currentSegment.track_id}`;
                const seekPositionMs = currentSegment.best_segment_start_seconds * 1000;

                console.log(`Gemini Playback: Playing URI ${trackUri} on device ${device_id} starting at ${seekPositionMs}ms`);

                fetch(`https://api.spotify.com/v1/me/player/play?device_id=${device_id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        uris: [trackUri],
                        position_ms: seekPositionMs // Start playing directly from the seek position
                    }),
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${props.token}` 
                    },
                })
                .then(response => {
                    if (!response.ok) {
                        console.error('Spotify API failed to start playback:', response.status, response.statusText);
                        response.json().then(data => console.error('Spotify API error details:', data));
                        setIsGeminiPlaybackActive(false); 
                        return;
                    }
                    console.log('Spotify API successfully started playback at specified position.');
                    setPaused(false); // Ensure UI reflects playing state
                    // No need for player.seek() anymore
                })
                .catch(e => {
                    console.error('Error calling Spotify Play API:', e);
                    setIsGeminiPlaybackActive(false); 
                });
            }
        }
    // Dependencies: React when Gemini playback is active, the analysis is ready, device_id is known, and current song index changes.
    }, [isGeminiPlaybackActive, geminiAnalysis, currentGeminiSongIndex, device_id, player, props.token]);

    // Function to fetch tracks for a selected playlist
    const fetchTracksForPlaylist = async (playlistId) => {
        if (!playlistId) return;
        setSelectedPlaylistId(playlistId);
        setIsLoadingTracks(true);
        setSelectedPlaylistTracks([]); // Clear previous tracks
        console.log(`Fetching tracks for playlist ID: ${playlistId}`);
        try {
            const response = await fetch(`/api/playlist-tracks/${playlistId}`);
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            const tracks = await response.json();
            setSelectedPlaylistTracks(tracks || []);
            console.log('Fetched tracks for selected playlist:', tracks);
            
            // NEXT STEP: Send these 'tracks' to Gemini API via another backend call
            if (tracks && tracks.length > 0) {
                analyzeTracksWithGemini(tracks);
            }

        } catch (error) {
            console.error(`Failed to fetch tracks for playlist ${playlistId}:`, error);
            setSelectedPlaylistTracks([]);
        } finally {
            setIsLoadingTracks(false);
        }
    };

    // Function to call our backend to analyze tracks with Gemini
    const analyzeTracksWithGemini = async (tracksToAnalyze) => {
        console.log('Sending tracks to Gemini for analysis:', tracksToAnalyze);
        try {
            const response = await fetch('/api/analyze-tracks-with-gemini', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tracks: tracksToAnalyze }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                setIsGeminiPlaybackActive(false);
                setGeminiAnalysis(null);
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const analysisResult = await response.json();
            console.log('Received analysis from Gemini:', analysisResult);
            
            if (analysisResult && analysisResult.song_segments && analysisResult.song_segments.length > 0) {
                // Use the tracksToAnalyze passed into this function, not selectedPlaylistTracks from state,
                // as state updates are async and selectedPlaylistTracks might not be updated yet.
                console.log('Tracks used for mapping (tracksToAnalyze argument):', tracksToAnalyze);

                const song_segments_with_real_ids = analysisResult.song_segments.map((geminiSegment, index) => {
                    if (tracksToAnalyze && index < tracksToAnalyze.length) { // Use tracksToAnalyze here
                        const originalTrack = tracksToAnalyze[index];       // Use tracksToAnalyze here
                        if (originalTrack && originalTrack.id && originalTrack.name) {
                            return {
                                ...geminiSegment, 
                                track_id: originalTrack.id, 
                                track_name: originalTrack.name 
                            };
                        } else {
                            console.warn(`Mapping issue: originalTrack from tracksToAnalyze at index ${index} is invalid or missing id/name.`, originalTrack);
                            return undefined; 
                        }
                    }
                    console.warn(`Mapping issue: index ${index} out of bounds for tracksToAnalyze or tracksToAnalyze is null.`);
                    return undefined; 
                }).filter(segment => segment !== undefined); 

                if (song_segments_with_real_ids.length > 0) {
                    setGeminiAnalysis({
                        ...analysisResult, // Keep radio_commentary as is
                        song_segments: song_segments_with_real_ids
                    });
                    setCurrentGeminiSongIndex(0); 
                    setIsGeminiPlaybackActive(true); 
                } else {
                    console.warn('Gemini analysis mapping failed or resulted in no valid segments.');
                    setIsGeminiPlaybackActive(false);
                    setGeminiAnalysis(null);
                }
            } else {
                console.warn('Gemini analysis did not return valid song segments.');
                setIsGeminiPlaybackActive(false);
                setGeminiAnalysis(null);
            }

        } catch (error) {
            console.error('Failed to analyze tracks with Gemini:', error);
            setIsGeminiPlaybackActive(false);
            setGeminiAnalysis(null);
        }
    };

    // Function to fetch playlists
    const fetchPlaylists = async () => {
        setIsLoadingPlaylists(true);
        try {
            const response = await fetch('/api/playlists');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            let data = await response.json();
            // Assign a random color to each playlist when fetched
            if (Array.isArray(data)) {
                data = data.map(playlist => ({
                    ...playlist,
                    displayColor: getRandomLightColor()
                }));
            }
            setPlaylists(data || []); // Ensure data is an array
        } catch (error) {
            console.error("Failed to fetch playlists:", error);
            setPlaylists([]); // Set to empty array on error
        } finally {
            setIsLoadingPlaylists(false);
        }
    };

    // Function to play radio commentary using Web Speech API
    const playCommentary = (text) => {
        if (!text || !('speechSynthesis' in window)) {
            console.warn('Speech synthesis not supported or no text to speak.');
            advanceToNextGeminiSegment();
            return;
        }

        window.speechSynthesis.cancel();
        // Clear any existing fade intervals
        if (fadeInIntervalRef.current) clearInterval(fadeInIntervalRef.current);
        if (fadeOutIntervalRef.current) clearInterval(fadeOutIntervalRef.current);

        const utterance = new SpeechSynthesisUtterance(text);
        
        // Attempt to find and set a female, enthusiastic voice
        try {
            const voices = window.speechSynthesis.getVoices();
            let femaleVoice = null;

            // First, try to find a voice explicitly labeled as female or with common female voice names
            for (let i = 0; i < voices.length; i++) {
                if (voices[i].name.toLowerCase().includes('female') || 
                    voices[i].name.toLowerCase().includes('woman') || 
                    voices[i].name.toLowerCase().includes('girl') ||
                    // Add common default female voice names if known, e.g.:
                    voices[i].name.includes('Zira') || // Microsoft Zira
                    voices[i].name.includes('Susan') || // Apple Susan
                    voices[i].name.includes('Google US English') // Often female by default
                    ) {
                    femaleVoice = voices[i];
                    break;
                }
            }

            // Fallback: If no clearly labeled female voice, try to pick a US English voice 
            // (often defaults to female, or provides a good base)
            if (!femaleVoice) {
                for (let i = 0; i < voices.length; i++) {
                    if (voices[i].lang === 'en-US') {
                        femaleVoice = voices[i];
                        // If we find a US English voice, and it's not clearly male, prefer it.
                        if (!voices[i].name.toLowerCase().includes('male')){
                           break;
                        }                        
                    }
                }
            }
            
            // If a female voice is found, use it.
            if (femaleVoice) {
                utterance.voice = femaleVoice;
                console.log('Using voice:', femaleVoice.name);
            } else {
                console.warn('Female voice not found, using default.');
            }

            // Adjust rate and pitch for enthusiasm
            utterance.rate = 1.15; // Normal is 1. Range 0.1 to 10.
            utterance.pitch = 1.1; // Normal is 1. Range 0 to 2.
            // utterance.volume = 1; // Normal is 1. Range 0 to 1.

        } catch (e) {
            console.error('Error setting voice:', e);
        }

        utterance.onstart = () => {
            console.log('Commentary speaking started...');
            setIsCommentarySpeaking(true);
            if (player && !is_paused) player.pause(); // Pause Spotify player

            // Start background music with fade-in
            if (backgroundAudioRef.current && backgroundAudioRef.current.src && backgroundAudioRef.current.src !== window.location.href) { // check src is not empty and not just the base URL
                try {
                    backgroundAudioRef.current.volume = 0;
                    backgroundAudioRef.current.currentTime = 0; // Start from beginning
                    backgroundAudioRef.current.play().then(() => {
                        console.log('Background music playing, beginning fade-in.');
                        let currentVolume = 0;
                        const targetVolume = BACKGROUND_MUSIC_VOLUME;
                        const steps = FADE_DURATION_MS / FADE_INTERVAL_MS;
                        const volumeStep = targetVolume / steps;
                        
                        fadeInIntervalRef.current = setInterval(() => {
                            currentVolume += volumeStep;
                            if (currentVolume >= targetVolume) {
                                backgroundAudioRef.current.volume = targetVolume;
                                clearInterval(fadeInIntervalRef.current);
                                console.log('Background music fade-in complete.');
                            } else {
                                backgroundAudioRef.current.volume = currentVolume;
                            }
                        }, FADE_INTERVAL_MS);
                    }).catch(e => console.error("Error playing background music:", e));
                } catch (e) {
                    console.error("Error setting up background music play:", e);
                }
            } else {
                if (backgroundAudioRef.current && (!backgroundAudioRef.current.src || backgroundAudioRef.current.src === window.location.href)) {
                    console.warn('Background music src is not set or invalid. Skipping background music.');
                }
            }
        };

        utterance.onend = () => {
            console.log('Commentary speaking ended.');
            setIsCommentarySpeaking(false);

            // Fade out background music, then advance
            if (backgroundAudioRef.current && backgroundAudioRef.current.volume > 0 && !backgroundAudioRef.current.paused) {
                console.log('Starting background music fade-out.');
                let currentVolume = backgroundAudioRef.current.volume;
                const steps = FADE_DURATION_MS / FADE_INTERVAL_MS;
                const volumeStep = currentVolume / steps; // Calculate step based on current volume

                fadeOutIntervalRef.current = setInterval(() => {
                    currentVolume -= volumeStep;
                    if (currentVolume <= 0) {
                        backgroundAudioRef.current.volume = 0;
                        backgroundAudioRef.current.pause();
                        // backgroundAudioRef.current.currentTime = 0; // Optionally reset time
                        clearInterval(fadeOutIntervalRef.current);
                        console.log('Background music fade-out complete and paused.');
                        advanceToNextGeminiSegment(); 
                    } else {
                        backgroundAudioRef.current.volume = currentVolume;
                    }
                }, FADE_INTERVAL_MS);
            } else {
                // No background music was playing or it's already silent/paused
                console.log('No active background music to fade out, advancing.');
                advanceToNextGeminiSegment();
            }
        };

        utterance.onerror = (event) => {
            console.error('SpeechSynthesisUtterance.onerror', event);
            setIsCommentarySpeaking(false);
            // Ensure background music is stopped/faded out if it was playing
             if (fadeInIntervalRef.current) clearInterval(fadeInIntervalRef.current);
            if (fadeOutIntervalRef.current) clearInterval(fadeOutIntervalRef.current); // Clear any pending fade out too
            if (backgroundAudioRef.current && !backgroundAudioRef.current.paused) {
                backgroundAudioRef.current.pause(); 
                backgroundAudioRef.current.volume = 0;
                console.log('Background music stopped due to TTS error.');
            }
            advanceToNextGeminiSegment(); // Proceed even if TTS fails
        };
        
        window.speechSynthesis.speak(utterance);
    };

    // Function to advance to the next Gemini song segment or end playback
    const advanceToNextGeminiSegment = () => {
        if (geminiAnalysis && currentGeminiSongIndex < geminiAnalysis.song_segments.length - 1) {
            setCurrentGeminiSongIndex(prevIndex => prevIndex + 1);
        } else {
            console.log('Gemini Playback: All segments and commentary played.');
            setIsGeminiPlaybackActive(false); // End Gemini mode
        }
    };

    if (!is_active) { 
        return (
            <>
                {/* Adjusted for centering - this message might need its own centered container if shown often */}
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                        <b> Instance not active. Transfer your playback using your Spotify app </b>
                </div>
                {/* Hidden Audio Player for Background Music */}
                <audio ref={backgroundAudioRef} src="/lofi-chill-jazz-272869.mp3" loop /> 
                {/* IMPORTANT: Ensure lofi-chill-jazz-272869.mp3 is in your public folder */}
            </>
        );
    } else {
        return (
            <div style={{ textAlign: 'center' }}> {/* Main container for centering */}
                {/* Hidden Audio Player for Background Music */}
                <audio ref={backgroundAudioRef} src="/lofi-chill-jazz-272869.mp3" loop /> 
                {/* IMPORTANT: Ensure lofi-chill-jazz-272869.mp3 is in your public folder */}

                {/* Player Section - Centered Top */}
                <div className="container" style={{ margin: '20px auto', maxWidth: '500px' }}>
                    <div className="main-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <img src={current_track.album.images[0].url} className="now-playing__cover" alt="" style={{ width: '200px', height: '200px', marginBottom: '10px' }}/>
                        <div className="now-playing__side" style={{ textAlign: 'center' }}>
                            <div className="now-playing__name">{current_track.name}</div>
                            <div className="now-playing__artist">{current_track.artists[0].name}</div>

                            {/* Seek Bar */}
                            <div style={{ margin: '10px 0' }}>
                                <progress value={track_position} max={track_duration} style={{ width: '100%' }}></progress>
                                <div style={{ fontSize: '0.8em', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{new Date(track_position).toISOString().substr(14, 5)}</span>
                                    <span>{new Date(track_duration).toISOString().substr(14, 5)}</span>
                                </div>
                            </div>

                            {/* Ensure buttons are in a row */}
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}> 
                                <button className="btn-spotify" onClick={() => { player.previousTrack() }} style={{ margin: '5px' }}>
                                &lt;&lt;
                            </button>
                                <button className="btn-spotify" onClick={() => { player.togglePlay() }} style={{ margin: '5px' }}>
                                { is_paused ? "PLAY" : "PAUSE" }
                            </button>
                                <button className="btn-spotify" onClick={() => { player.nextTrack() }} style={{ margin: '5px' }}>
                                &gt;&gt;
                            </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Playlist Section */}
                <div className="playlists-section" style={{ marginTop: '30px' }}>
                    <h2 style={{ textAlign: 'center' }}>Your Playlists</h2>
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}> {/* Centering the button */}
                        <button onClick={fetchPlaylists} disabled={isLoadingPlaylists} className="btn-spotify">
                            {isLoadingPlaylists ? 'Loading...' : 'Load My Playlists'}
                        </button>
                    </div>
                    
                    {/* Playlist Boxes Display */}
                    {playlists.length > 0 && (
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                            gap: '20px',
                            padding: '20px'
                        }}>
                            {playlists.map(playlist => (
                                <div key={playlist.id} style={{
                                    backgroundColor: playlist.displayColor || getRandomLightColor(), // Use stored color, fallback if undefined
                                    color: '#333', // Dark text
                                    width: '150px', 
                                    height: '150px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    padding: '10px',
                                    borderRadius: '8px',
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    boxShadow: selectedPlaylistId === playlist.id ? '0 0 15px 5px #65D46E' : '0 4px 8px rgba(0,0,0,0.1)', // Highlight selected
                                    cursor: 'pointer',
                                    transition: 'transform 0.2s ease, boxShadow 0.2s ease',
                                    transform: selectedPlaylistId === playlist.id ? 'scale(1.05)' : 'scale(1)'
                                }}
                                onClick={() => fetchTracksForPlaylist(playlist.id)} // Call new function on click
                                >
                                    {playlist.name}
                                    {/* Display a loading indicator for tracks if this playlist is selected and tracks are loading */}
                                    {selectedPlaylistId === playlist.id && isLoadingTracks && <p style={{fontSize: '0.7em', marginTop: '5px'}}>(Loading tracks...)</p>}
                                </div>
                            ))}
                        </div>
                    )}
                    { !isLoadingPlaylists && playlists.length === 0 && <p style={{ textAlign: 'center' }}>No playlists found or loaded.</p>}
                </div>
            </div>
        );
    }
}

export default WebPlayback
