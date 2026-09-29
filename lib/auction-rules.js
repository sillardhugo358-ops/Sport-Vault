'use strict';

// Règles de calcul des enchères.

function auctionDurationMs(minutes){return Number(minutes)*60_000;}
function auctionMinBid(current){return Math.ceil(Number(current)*11/10);}

module.exports = { auctionDurationMs, auctionMinBid };
