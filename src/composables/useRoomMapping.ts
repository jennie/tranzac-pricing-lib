// composables/useRoomMapping.ts

import { ref } from "vue";

const roomMapping = ref([
  {
    id: "XW6I3qDESaGdI8AD38jkkg",
    name: "Zine Library",
    slug: "zine-library",
  },
  {
    id: "UmDJq9ZRTkeNOpj-Z9ptmw",
    name: "Parking Lot",
    slug: "parking-lot",
  },
  {
    id: "Ke9H-ZmbTVaEyFOwi3Lnvw",
    name: "Main Hall",
    slug: "main-hall",
  },
  {
    id: "XwOmPr9CTTeajkgUbdq7Qg",
    name: "The Full Building",
    slug: "the-full-building",
  },
  {
    id: "DhqLkkzvQmKvCDMubndPjw",
    name: "Southern Cross",
    slug: "southern-cross",
  },
  {
    id: "NduRmQk1RIy_xgdXp9RYuw",
    name: "Living Room",
    slug: "living-room",
  },
]);

const rooms = ref(roomMapping.value.map((room) => room.name));
export function useRoomMapping() {
  return {
    roomMapping,
    rooms,
  };
}
