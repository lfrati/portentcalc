// Cache for card data
const cardCache = new Map();
// persist decklist
const STORAGE_KEY = 'portentcalc_last_submitted_deck';

// Define all possible card types for reference
const CARD_TYPES = new Set([
    'Artifact', 'Battle', 'Creature', 'Enchantment', 
    'Instant', 'Kindred', 'Land', 'Planeswalker', 'Sorcery'
]);

async function fetchCardData(cardName) {
    // Check cache first
    if (cardCache.has(cardName)) {
        return cardCache.get(cardName);
    }

    const baseURL = "https://api.scryfall.com/cards/named?exact=";
    const encodedCardName = encodeURIComponent(cardName);
    
    try {
        const response = await fetch(`${baseURL}${encodedCardName}`);
        if (!response.ok) {
            throw new Error(`Card not found: ${cardName}`);
        }
        
        const data = await response.json();
        
        // Extract relevant information
        const cardData = {
            name: data.name,
            types: [], // We'll populate this from type_line
            cmc: data.cmc || 0,
            imageUrl: data.image_uris?.normal || null,
            typeLine: data.type_line || ''
        };

        // Parse type line to extract types
        const typeLine = data.type_line.toLowerCase();
        
        // Extract types that we care about
        CARD_TYPES.forEach(type => {
            if (typeLine.includes(type.toLowerCase())) {
                cardData.types.push(type);
            }
        });

        // Store in cache
        cardCache.set(cardName, cardData);
        return cardData;
    } catch (error) {
        console.error(`Error fetching card data for ${cardName}:`, error);
        throw error;
    }
}

function displayDeckComposition(composition) {
    const debugDiv = document.getElementById('deck-debug');
    const compDiv = document.getElementById('deck-composition');
    debugDiv.style.display = 'block';
    
    let html = '<div class="deck-composition">';
    let tot = 0;
    for (const [cardName, info] of composition) {
        tot += info.quantity;
        const escapedCardName = cardName.replace(/'/g, "\\'");
        html += `
            <div class="card-entry">
                <div class="card-main-info">
                    <span class="card-quantity">${info.quantity}x</span>
                    <span class="card-name">${cardName}</span>
                </div>
                <span class="card-types">${info.types.join(', ')}</span>
                <span class="card-cmc">cmc <b>${String(info.cmc).padStart(2, ' ').replace(/ /g, '&nbsp;')}</b></span>
            </div>        `;
    }
    html += '</div>';
    html += `<span><b>Total: ${tot} cards</b></span>`;
    
    compDiv.innerHTML = html;
}

function parseDecklist(text) {
    const mainDeck = [];
    const lines = text.trim().split('\n');
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || trimmedLine === 'Deck') continue;

        const parts = trimmedLine.split(' ', 1);
        const quantity = parseInt(parts[0]);
        const name = trimmedLine.substring(parts[0].length + 1);

        if (name && !isNaN(quantity)) {
            mainDeck.push([quantity, name]);
        }
    }

    return mainDeck;
}

async function buildDeckArray(deckList) {
    const deck = [];
    const composition = new Map();
    const loadingOverlay = document.getElementById('loading-overlay');
    
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    }
    
    try {
        // Fetch all card data first
        for (const [quantity, cardName] of deckList) {
            try {
                const cardData = await fetchCardData(cardName);
                composition.set(cardName, { quantity, cmc: cardData.cmc, types: cardData.types });
                
                for (let i = 0; i < quantity; i++) {
                    deck.push({ name: cardName, cmc: cardData.cmc, types: cardData.types});
                }
            } catch (error) {
                console.error(`Error processing card: ${cardName}`, error);
                // Optionally show error to user
                const errorDiv = document.getElementById('error-messages');
                if (errorDiv) {
                    errorDiv.innerHTML += `<div>Failed to load: ${cardName}</div>`;
                }
            }
            displayDeckComposition(composition);
        }
        
        return deck;
    } finally {
        if (loadingOverlay) {
            loadingOverlay.style.display = 'none';
        }
    }
}

function maximizePortentSelection(revealedCards) {
    // Group cards by their types
    const typeToCards = new Map();
    revealedCards.forEach(card => {
        card.types.forEach(type => {
            if (!typeToCards.has(type)) {
                typeToCards.set(type, []);
            }
            typeToCards.get(type).push(card);
        });
    });

    // Sort cards within each type by mana cost (descending)
    typeToCards.forEach(cards => {
        cards.sort((a, b) => b.cmc - a.cmc);
    });

    // Find the best selection using a greedy approach
    const selectedCards = new Set();
    const usedTypes = new Set();
    let highestCostSpell = null;

    // First pass: Select highest mana cost cards for each unique type
    CARD_TYPES.forEach(type => {
        const cards = typeToCards.get(type) || [];
        for (const card of cards) {
            // Skip if we've already used this card through another type
            if (selectedCards.has(card)) continue;
            
            // Check if we can use this card (haven't used all its types)
            const canUseCard = !card.types.every(t => usedTypes.has(t));
            
            if (canUseCard) {
                selectedCards.add(card);
                card.types.forEach(t => usedTypes.add(t));
                
                // Update highest cost spell if this is one
                if (!card.types.includes('Land') && (!highestCostSpell || card.cmc > highestCostSpell.cmc)) {
                    highestCostSpell = card;
                }
                break;
            }
        }
    });

    // Second pass: Try to add more cards if we haven't hit 4 types yet
    if (selectedCards.size < 4 && selectedCards.size > 0) {
        const potentialAdditions = revealedCards.filter(card => 
            !selectedCards.has(card) && 
            card.types.some(type => !usedTypes.has(type))
        );

        // Sort by number of unused types (descending)
        potentialAdditions.sort((a, b) => {
            const aUnused = a.types.filter(t => !usedTypes.has(t)).length;
            const bUnused = b.types.filter(t => !usedTypes.has(t)).length;
            return bUnused - aUnused;
        });

        // Try to add cards until we hit 4 or run out of options
        for (const card of potentialAdditions) {
            if (selectedCards.size >= 4) break;
            
            const unusedTypes = card.types.filter(t => !usedTypes.has(t));
            if (unusedTypes.length > 0) {
                selectedCards.add(card);
                unusedTypes.forEach(t => usedTypes.add(t));
                
                if (!card.types.includes('Land') && (!highestCostSpell || card.cmc > highestCostSpell.cmc)) {
                    highestCostSpell = card;
                }
            }
        }
    }

    return usedTypes.size;
}

function simulatePortent(deck, X) {
    const revealedCards = [];
    const deckCopy = [...deck];
    
    // Randomly select X cards
    for (let i = 0; i < X && deckCopy.length > 0; i++) {
        const randomIndex = Math.floor(Math.random() * deckCopy.length);
        revealedCards.push(deckCopy[randomIndex]);
        deckCopy.splice(randomIndex, 1);
    }
    
    return maximizePortentSelection(revealedCards);
}

let averageChart = null;
let successChart = null;

function displayAverageChart(data) {
    const ctx = document.getElementById('averageChart').getContext('2d');
    
    if (averageChart) {
        averageChart.destroy();
    }

    const yValues = data.map(d => d.y);
    const minY = Math.min(...yValues) * 0.9;
    const maxY = Math.max(...yValues) * 1.1;

    averageChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Average Distinct Types',
                data: data,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgb(75, 192, 192)',
                borderWidth: 2,
                tension: 0.1,
                pointRadius: 4,
                fill: false
            }, {
                label: 'Target (4 types)',
                data: data.map(d => ({ x: d.x, y: 4 })),
                borderColor: 'rgba(255, 99, 132, 0.8)',
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: minY,
                    max: maxY,
                    title: {
                        display: true,
                        text: 'Average Number of Distinct Types'
                    }
                },
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'X Value'
                    }
                }
            }
        }
    });
}

function displaySuccessChart(data) {
    const ctx = document.getElementById('successChart').getContext('2d');
    
    if (successChart) {
        successChart.destroy();
    }

    successChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'Success Rate (≥4 Types)',
                data: data,
                borderColor: 'rgb(255, 159, 64)',
                backgroundColor: 'rgb(255, 159, 64)',
                borderWidth: 2,
                tension: 0.1,
                pointRadius: 4,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    min: 0,
                    max: 100,
                    title: {
                        display: true,
                        text: 'Success Rate (%) '
                    }
                },
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: 'X Value '
                    }
                }
            }
        }
    });
}

function displayResults(results) {
    const resultsDiv = document.getElementById('results');
    resultsDiv.style.display = 'block';

    const averageData = [];
    const successData = [];

    for (const [x, values] of Object.entries(results)) {
        const xNum = parseInt(x);
        
        const mean = values.reduce((a, b) => a + b) / values.length;
        averageData.push({ x: xNum, y: mean });
        
        const successCount = values.filter(v => v >= 4).length;
        const successRate = (successCount / values.length) * 100;
        successData.push({ x: xNum, y: successRate });
    }

    displayAverageChart(averageData);
    displaySuccessChart(successData);
}

async function analyzeDeck() {
    const input = document.getElementById('cardList').value;

    // Save the deck list before analysis
    saveDeckToStorage(input);

    const mainDeck = parseDecklist(input);
    
    try {
        const deck = await buildDeckArray(mainDeck);
        
        if (deck.length === 0) {
            alert('No valid cards found in the deck list!');
            return;
        }

        const trials = 10000;
        const results = {};

        for (let X = 4; X <= 10; X++) {
            results[X] = [];
            for (let trial = 0; trial < trials; trial++) {
                results[X].push(simulatePortent(deck, X));
            }
        }

        displayResults(results);
    } catch (error) {
        console.error('Error analyzing deck:', error);
        alert('Error analyzing deck. Please check the console for details.');
    }
}


// Save deck list to local storage
function saveDeckToStorage(deckList) {
    try {
        localStorage.setItem(STORAGE_KEY, deckList);
    } catch (error) {
        console.error('Error saving deck to local storage:', error);
    }
}

// Load deck list from local storage
function loadDeckFromStorage() {
    try {
        const savedDeck = localStorage.getItem(STORAGE_KEY);
        if (savedDeck) {
            const cardListTextarea = document.getElementById('cardList');
            if (cardListTextarea) {
                cardListTextarea.value = savedDeck;
            }
        }
    } catch (error) {
        console.error('Error loading deck from local storage:', error);
    }
}

// Modify the existing analyzeDeck function to save the deck list
async function analyzeDeckWithStorage() {
    const input = document.getElementById('cardList').value;
    
    // Save the deck list before analysis
    saveDeckToStorage(input);
    
    const mainDeck = parseDecklist(input);
    
    try {
        const deck = await buildDeckArray(mainDeck);
        
        if (deck.length === 0) {
            alert('No valid cards found in the deck list!');
            return;
        }

        const trials = 10000;
        const results = {};

        for (let X = 4; X <= 10; X++) {
            results[X] = [];
            for (let trial = 0; trial < trials; trial++) {
                results[X].push(simulatePortent(deck, X));
            }
        }

        displayResults(results);
    } catch (error) {
        console.error('Error analyzing deck:', error);
        alert('Error analyzing deck. Please check the console for details.');
    }
}

// Initialize storage when the page loads
document.addEventListener('DOMContentLoaded', loadDeckFromStorage);

