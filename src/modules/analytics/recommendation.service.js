const discoveryService = require('../discovery/discovery.service');

async function getHomeRecommendations(query) {
  const result = await discoveryService.discover({ ...query, type: 'all', page: 1, limit: query.limit || 12, sort: 'newest' });
  return {
    strategy: 'location_freshness_v1',
    sections: [
      { key: 'new_near_you', title: 'New near you', products: result.products, services: [], businesses: [] },
      { key: 'book_your_next_look', title: 'Book your next look', products: [], services: result.services, businesses: [] },
      { key: 'popular_businesses', title: 'Businesses to explore', products: [], services: [], businesses: result.businesses }
    ],
    meta: result.meta
  };
}

module.exports = { getHomeRecommendations };
