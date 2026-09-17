/**
 * PawBook Real Images
 * All sourced from Unsplash (free, no attribution required for display)
 * Replace emoji placeholders across all pages
 */

const IMG = {
  // Dogs
  dog1:    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=400&q=80',
  dog2:    'https://images.unsplash.com/photo-1552053831-71594a27632d?w=400&q=80',
  dog3:    'https://images.unsplash.com/photo-1537151608828-ea2b11777ee8?w=400&q=80',
  dog4:    'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=400&q=80',
  dog5:    'https://images.unsplash.com/photo-1601979031925-424e53b6caaa?w=400&q=80',
  goldenRetriever: 'https://images.unsplash.com/photo-1633722715463-d30f4f325e24?w=600&q=80',
  beagle:  'https://images.unsplash.com/photo-1505628346881-b72b27e84530?w=400&q=80',
  labrador:'https://images.unsplash.com/photo-1591160690555-5d7e8ed5e2bd?w=400&q=80',
  husky:   'https://images.unsplash.com/photo-1617895153857-82fe79b41749?w=400&q=80',
  pug:     'https://images.unsplash.com/photo-1598133894008-61f7fdb8cc3a?w=400&q=80',

  // Cats
  cat1:    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=400&q=80',
  cat2:    'https://images.unsplash.com/photo-1533743983669-94fa5c4338ec?w=400&q=80',
  cat3:    'https://images.unsplash.com/photo-1573865526739-10659fec78a5?w=400&q=80',
  persian: 'https://images.unsplash.com/photo-1568152950566-c1bf43f4ab28?w=400&q=80',

  // Other pets
  rabbit:  'https://images.unsplash.com/photo-1585110396000-c9ffd4e4b308?w=400&q=80',
  bird:    'https://images.unsplash.com/photo-1552728089-57bdde30beb3?w=400&q=80',

  // Vets / humans
  vet1:    'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&q=80',
  vet2:    'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=200&q=80',
  vet3:    'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=200&q=80',
  vet4:    'https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=200&q=80',

  // Scenes
  petPark:     'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?w=800&q=80',
  petSwim:     'https://images.unsplash.com/photo-1568572933382-74d440642117?w=800&q=80',
  vetClinic:   'https://images.unsplash.com/photo-1628009368231-7bb7cfcb0def?w=800&q=80',
  adoption:    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=800&q=80',
  shelter:     'https://images.unsplash.com/photo-1548767797-d8c844163c4a?w=800&q=80',
  dogWalk:     'https://images.unsplash.com/photo-1450778869180-41d0601e046e?w=800&q=80',
  petFood:     'https://images.unsplash.com/photo-1589924691995-400dc9ecc119?w=400&q=80',
  petToy:      'https://images.unsplash.com/photo-1535930891776-0c2dfb7fda1a?w=400&q=80',
  petBed:      'https://images.unsplash.com/photo-1601758174114-e711c0cbaa69?w=400&q=80',
  petBath:     'https://images.unsplash.com/photo-1581888227599-779811939961?w=400&q=80',
  catFood:     'https://images.unsplash.com/photo-1574158622682-e40e69881006?w=400&q=80',

  // Cover/hero images  
  coverDog:    'https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=1200&q=80',
  coverCats:   'https://images.unsplash.com/photo-1574144611937-0df059b5ef3e?w=1200&q=80',
  heroAdopt:   'https://images.unsplash.com/photo-1415369629372-26f2fe60c467?w=1200&q=80',
  heroPets:    'https://images.unsplash.com/photo-1444212477490-ca407925329e?w=1200&q=80',
};

// Helper to create an img tag with fallback
function petImg(src, alt, style='') {
  return `<img src="${src}" alt="${alt}" style="width:100%;height:100%;object-fit:cover;${style}" onerror="this.style.display='none'">`;
}
