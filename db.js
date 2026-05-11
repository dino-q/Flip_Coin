(function () {
  "use strict";

  const DB_NAME = "coin-burst-db";
  const DB_VERSION = 1;
  const STORE_NAME = "coin_images";

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not available."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB."));
    });
  }

  function withStore(mode, callback) {
    return openDatabase().then((db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let requestResult;

        transaction.oncomplete = () => {
          db.close();
          resolve(requestResult);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error || new Error("IndexedDB transaction failed."));
        };

        requestResult = callback(store);
      }),
    );
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  async function putImage(id, file) {
    return withStore("readwrite", (store) =>
      store.put({
        id,
        blob: file,
        name: file.name,
        type: file.type,
        size: file.size,
        updatedAt: Date.now(),
      }),
    );
  }

  async function getImage(id) {
    const record = await withStore("readonly", (store) => requestToPromise(store.get(id)));
    return record || null;
  }

  async function deleteImages() {
    await withStore("readwrite", (store) => {
      store.delete("heads_image");
      store.delete("tails_image");
    });
  }

  window.CoinImageDB = {
    putImage,
    getImage,
    deleteImages,
  };
})();
