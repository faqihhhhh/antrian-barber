package realtime

import "sync"

// Hub adalah pub/sub sederhana di memori, satu per proses server. Cukup
// untuk satu instance VPS — kalau nanti di-scale ke lebih dari satu
// instance, ini yang perlu diganti ke Postgres LISTEN/NOTIFY atau Redis,
// tapi antarmukanya (Subscribe/Unsubscribe/Publish) bisa dipertahankan sama.
type Hub struct {
	mu   sync.RWMutex
	subs map[string]map[chan []byte]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[string]map[chan []byte]struct{})}
}

func (h *Hub) Subscribe(topic string) chan []byte {
	ch := make(chan []byte, 8)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subs[topic] == nil {
		h.subs[topic] = make(map[chan []byte]struct{})
	}
	h.subs[topic][ch] = struct{}{}
	return ch
}

func (h *Hub) Unsubscribe(topic string, ch chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.subs[topic][ch]; ok {
		delete(h.subs[topic], ch)
		close(ch)
	}
	if len(h.subs[topic]) == 0 {
		delete(h.subs, topic)
	}
}

// Publish mengirim payload ke semua subscriber topik ini. Pelanggan yang
// buffer-nya penuh (koneksi lambat/macet) dilewati, bukan memblokir
// publisher — kehilangan satu update realtime jauh lebih murah daripada
// memacetkan semua orang lain yang sedang mendengarkan.
func (h *Hub) Publish(topic string, payload []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.subs[topic] {
		select {
		case ch <- payload:
		default:
		}
	}
}