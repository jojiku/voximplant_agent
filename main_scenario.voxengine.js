require(Modules.ASR); // Подключаем модуль автоматического распознавания речи (ASR)

// 🔹 Класс для управления событиями
class EventEmitter {
  constructor() {
    this.events = {};
  }

  // Подписка на событие
  on(event, listener) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  // Вызов события
  emit(event, ...args) {
    if (this.events[event]) {
      this.events[event].forEach(listener => {
        listener(...args);
      });
    }
  }

  // Отписка от события
  off(event, listener) {
    if (this.events[event]) {
      this.events[event].filter(l => l !== listener);
    }
  }

  // Подписка на событие с однократным срабатыванием
  once(event, listener) {
    const onceListener = (...args) => {
      listener(...args);
      this.off(event, onceListener);
    };
    this.on(event, onceListener);
  }
}

class Player extends EventEmitter {
    constructor() {
        super();
        this.queue = [];  // Массив текстовых чанков
        this.status = false; // Состояние плеера
    }

    play() {
        if (!this.status) {
            this.status = true;
            this.emit('play');
        }
    }

    stop() {
        if (this.status) {
            this.status = false;
            this.emit('stop');
        }
    }

    // Добавляем новый плеер в очередь
    add(chank) {
        this.queue.push(chank);
        this.emit('added', chank); // Логируем добавление
        Logger.write("🎵 Добавлен новый чанк в очередь: " + chank);
    }

    // Удаляем первый элемент из очереди
    remove() {
        const chank = this.queue.shift();
        if (chank) {
            this.emit('removed', chank);
            Logger.write("🗑 Удалён чанк из очереди: " + chank);
        }
        return chank;
    }

    // Полностью очищаем очередь
    clear() {
        if (this.queue.length > 0) {
            this.queue = [];
            this.emit('cleared');
            Logger.write("🚮 Очередь полностью очищена");
        }
    }

    toggle() {
        this.status ? this.stop() : this.play();
    }

    get isPlaying() {
        return this.status;
    }

    // Возвращаем длину очереди
    get length() {
        return this.queue.length;
    }
}

// 🔹 Глобальные переменные
// URL нашего WebSocket сервера.
// ВАЖНО: Используйте wss для безопасного соединения.
const WEBSOCKET_URL = "wss://liabilities-continental-gerald-herbs.trycloudflare.com/ws";
let asr;
let call;
const defaultVoice = VoiceList.TBank.ru_RU_Anna;

var wsReady = false; // Флаг готовности WebSocket
const voicePlayer = new Player();

// Подписка на удаление из очереди (воспроизведение следующего чанка)
voicePlayer.on('removed', (text) => {
    playNextChunk(text); // Запускаем следующий чанк
});

// 🔹 Функция воспроизведения чанка
async function playNextChunk(text) {
    Logger.write("▶️ Начинаем воспроизведение: " + text);

    player = VoxEngine.createTTSPlayer(text, {
        language: defaultVoice
    });
    player.sendMediaTo(call);

    player.addEventListener(PlayerEvents.PlaybackFinished, () => {
        Logger.write("🔚 Воспроизведение завершено: " + text);
        voicePlayer.remove();
        
        // ДОБАВЬ ЭТО:
        if (voicePlayer.length === 0) {
            Logger.write("🎙 Снова слушаем пользователя");
            call.sendMediaTo(asr);
        }
    });
}

// 🔹 Обработчик входящего вызова
VoxEngine.addEventListener(AppEvents.CallAlerting, (e) => {
    call = e.call;
    Logger.write("📞 Входящий вызов: " + call.id);

    // Подключение к WebSocket-серверу
    const socket = VoxEngine.createWebSocket(WEBSOCKET_URL);
    Logger.write("🌐 Подключение к WebSocket...");

    // WebSocket открыт
    socket.addEventListener(WebSocketEvents.OPEN, () => {
        wsReady = true;
        Logger.write("✅ WebSocket подключён!");
    });

    // WebSocket получает сообщение
    socket.addEventListener(WebSocketEvents.MESSAGE, (event) => {
        Logger.write("📩 Получено сообщение от WebSocket: " + event.text);
        if (event.text) {
            voicePlayer.add(event.text);
            
            if (voicePlayer.length === 1) {
                voicePlayer.remove();
            }
        }
    });

    // WebSocket ошибка
    socket.addEventListener(WebSocketEvents.ERROR, (event) => {
        Logger.write("❌ WebSocket ошибка: " + JSON.stringify(event));
    });

    // WebSocket закрыт
    socket.addEventListener(WebSocketEvents.CLOSE, () => {
        wsReady = false;
        Logger.write("🔴 WebSocket соединение закрыто.");
    });

    // 🔹 Голосовое приветствие при подключении вызова
    call.addEventListener(CallEvents.Connected, () => {
        Logger.write("✅ Вызов подключен.");
        
        // CREATE ASR HERE, AFTER CALL IS CONNECTED
        asr = VoxEngine.createASR({
            profile: ASRProfileList.TBank.ru_RU,
            singleUtterance: true
        });

        // asr.addEventListener(ASREvents.Error, (e) => {
        //     Logger.write("❌ ASR ошибка: " + (e ? JSON.stringify(e) : "нет данных"));
        // });

        // asr.addEventListener(ASREvents.Stopped, () => {
        //     Logger.write("⏹ ASR остановлен");
        // });

        // asr.addEventListener(ASREvents.CaptureStarted, () => {
        //     Logger.write("🎤 ASR начал захват речи");
        // });

        asr.addEventListener(ASREvents.Result, (e) => {
            Logger.write("🎤 ASR распознал: " + e.text);

            if (e.text) {
                if (wsReady) {
                    socket.send(e.text);
                    voicePlayer.stop();
                    voicePlayer.clear();
                    Logger.write("📤 Отправлено в WebSocket: " + e.text);
                } else {
                    Logger.write("⚠️ WebSocket ещё не готов, сообщение не отправлено.");
                }
            }
        });
        
        player = VoxEngine.createTTSPlayer('Здравствуйте!', {
            language: defaultVoice
        });
        player.sendMediaTo(call);

        player.addEventListener(PlayerEvents.PlaybackFinished, () => {
            Logger.write("🎙 Начинаем слушать пользователя");
            call.sendMediaTo(asr);
        });
    });

    // 🔹 Завершение вызова
    call.addEventListener(CallEvents.Disconnected, () => {
        Logger.write("🔚 Вызов завершён.");
        VoxEngine.terminate();
    });

    call.answer();
});