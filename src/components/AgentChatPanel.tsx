import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, X, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function AgentChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMessage = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', content: userMessage, timestamp: new Date() }]);
    setLoading(true);

    try {
      // Replace with your Hermes API endpoint
      const res = await fetch('/api/hermes/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add resort profile header if your backend uses it
          // 'X-Resort-Profile': 'your-resort-id',
          // Add auth header if needed
          // 'Authorization': `Bearer ${yourToken}`,
        },
        body: JSON.stringify({ 
          message: userMessage,
          // Optional: include current tab context
          context: 'admin-panel'
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages(m => [...m, { 
        role: 'assistant', 
        content: data.reply || 'No response from agent.', 
        timestamp: new Date() 
      }]);
    } catch (err: any) {
      setMessages(m => [...m, { 
        role: 'assistant', 
        content: `Agent unavailable: ${err.message}. Connect Hermes first.`, 
        timestamp: new Date() 
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating toggle */}
      {!open && (
        <Button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg bg-primary hover:bg-primary/90"
          aria-label="Open agent chat"
        >
          <MessageSquare className="w-6 h-6" />
        </Button>
      )}

      {/* Chat dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md h-[600px] flex flex-col p-0 gap-0 bg-card border-border">
          <DialogHeader className="px-4 py-3 border-b border-border flex flex-row items-center justify-between">
            <DialogTitle className="font-display text-sm tracking-wider text-foreground">
              BAIA Assistant
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </DialogHeader>

          <ScrollArea className="flex-1 px-4 py-3" ref={scrollRef}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground font-body text-sm gap-2">
                <MessageSquare className="w-10 h-10 opacity-40" />
                <p>Ask me anything about your resort operations.</p>
                <p className="text-xs opacity-60">Try: "How many arrivals today?" or "Show kitchen orders"</p>
              </div>
            )}

            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 font-body text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary border border-border text-foreground'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-[10px] mt-1 opacity-70 ${
                      msg.role === 'user' ? 'text-primary-foreground' : 'text-muted-foreground'
                    }`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-secondary border border-border rounded-lg px-3 py-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="px-4 py-3 border-t border-border flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
              placeholder="Type a message..."
              className="font-body bg-secondary border-border text-foreground"
              disabled={loading}
            />
            <Button 
              onClick={sendMessage} 
              disabled={loading || !input.trim()} 
              className="px-3"
              aria-label="Send message"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
