import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Video, VideoOff } from 'lucide-react';

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function CallOverlay({ socket, currentUser, peer, conversationId }) {
  const [state, setState] = useState('idle');
  const [callType, setCallType] = useState('audio');
  const [callId, setCallId] = useState(null);
  const [incoming, setIncoming] = useState(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peerConnection = useRef(null);
  const localStream = useRef(null);

  function cleanup(nextState = 'idle') {
    localStream.current?.getTracks().forEach((track) => track.stop());
    peerConnection.current?.close();
    peerConnection.current = null;
    localStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setIncoming(null); setCallId(null); setMuted(false); setCameraOff(false); setState(nextState);
  }
  async function prepareMedia(type) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
    localStream.current = stream;
    if (localVideo.current) localVideo.current.srcObject = stream;
    return stream;
  }
  async function createPeer(type, id) {
    const stream = localStream.current || await prepareMedia(type);
    const pc = new RTCPeerConnection(rtcConfig);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    pc.ontrack = (event) => { if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0]; };
    pc.onicecandidate = (event) => { if (event.candidate) socket.emit('ice-candidate', { targetUserId: peer.id, conversationId, callId: id, candidate: event.candidate }); };
    peerConnection.current = pc;
    return pc;
  }
  async function start(type) {
    if (!peer?.id || !socket) return;
    try { const id = crypto.randomUUID(); setCallType(type); setCallId(id); setState('calling'); await prepareMedia(type); socket.emit('call-user', { targetUserId: peer.id, conversationId, callId: id, callType: type }); } catch { setState('failed'); }
  }
  async function accept() {
    if (!incoming) return;
    try { setCallId(incoming.callId); setCallType(incoming.callType); await prepareMedia(incoming.callType); await createPeer(incoming.callType, incoming.callId); socket.emit('call-accepted', { targetUserId: incoming.fromUserId, conversationId, callId: incoming.callId, callType: incoming.callType }); setState('connected'); } catch { socket.emit('call-rejected', { targetUserId: incoming.fromUserId, conversationId, callId: incoming.callId }); setState('failed'); }
  }
  useEffect(() => {
    if (!socket) return undefined;
    const onIncoming = (payload) => { if (payload.conversationId === conversationId && payload.targetUserId === currentUser.id) { setIncoming(payload); setCallType(payload.callType); setCallId(payload.callId); setState('ringing'); } };
    const onAccepted = async (payload) => { if (payload.callId !== callId) return; try { const pc = await createPeer(callType, callId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit('webrtc-offer', { targetUserId: peer.id, conversationId, callId, offer }); setState('connected'); } catch { setState('failed'); } };
    const onOffer = async (payload) => { if (payload.callId !== callId) return; try { const pc = peerConnection.current || await createPeer(callType, callId); await pc.setRemoteDescription(payload.offer); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit('webrtc-answer', { targetUserId: peer.id, conversationId, callId, answer }); setState('connected'); } catch { setState('failed'); } };
    const onAnswer = async (payload) => { if (payload.callId === callId) await peerConnection.current?.setRemoteDescription(payload.answer); };
    const onIce = async (payload) => { if (payload.callId === callId && peerConnection.current) await peerConnection.current.addIceCandidate(payload.candidate); };
    const onRejected = (payload) => { if (payload.callId === callId) cleanup('rejected'); };
    const onEnded = (payload) => { if (payload.callId === callId) cleanup('ended'); };
    socket.on('incoming-call', onIncoming); socket.on('call-accepted', onAccepted); socket.on('webrtc-offer', onOffer); socket.on('webrtc-answer', onAnswer); socket.on('ice-candidate', onIce); socket.on('call-rejected', onRejected); socket.on('call-ended', onEnded);
    return () => { socket.off('incoming-call', onIncoming); socket.off('call-accepted', onAccepted); socket.off('webrtc-offer', onOffer); socket.off('webrtc-answer', onAnswer); socket.off('ice-candidate', onIce); socket.off('call-rejected', onRejected); socket.off('call-ended', onEnded); };
  }, [socket, conversationId, currentUser.id, peer?.id, callId, callType]);
  function endCall() { if (callId && peer?.id) socket.emit('call-ended', { targetUserId: peer.id, conversationId, callId }); cleanup('ended'); }
  function toggleMute() { localStream.current?.getAudioTracks().forEach((track) => { track.enabled = muted; }); setMuted((value) => !value); }
  function toggleCamera() { localStream.current?.getVideoTracks().forEach((track) => { track.enabled = cameraOff; }); setCameraOff((value) => !value); }
  if (!peer?.id || !conversationId) return null;
  return <>
    <div className="call-actions"><button title="Audio call" onClick={() => start('audio')}><Phone size={18} /></button><button title="Video call" onClick={() => start('video')}><Video size={18} /></button></div>
    {state !== 'idle' && <div className="call-overlay"><section className="call-card"><div className="call-avatar">{peer?.name?.slice(0, 2).toUpperCase()}</div><h2>{state === 'ringing' ? `${peer?.name} is calling` : state === 'calling' ? `Calling ${peer?.name}` : state === 'connected' ? peer?.name : `Call ${state}`}</h2><p>{callType === 'video' ? 'Video call' : 'Audio call'} {state === 'connected' ? 'connected' : ''}</p>{callType === 'video' && <div className="video-stage"><video ref={remoteVideo} autoPlay playsInline className="remote-video" /><video ref={localVideo} autoPlay muted playsInline className="local-video" /></div>}{state === 'ringing' ? <div className="call-controls"><button className="accept-call" onClick={accept}><PhoneCall size={18} /> Accept</button><button className="end-call" onClick={() => { socket.emit('call-rejected', { targetUserId: incoming.fromUserId, conversationId, callId }); cleanup('rejected'); }}><PhoneOff size={18} /> Reject</button></div> : <div className="call-controls">{state === 'connected' && <><button title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted ? <MicOff size={18} /> : <Mic size={18} />}</button>{callType === 'video' && <button title={cameraOff ? 'Turn camera on' : 'Turn camera off'} onClick={toggleCamera}>{cameraOff ? <VideoOff size={18} /> : <Video size={18} />}</button>}</>}<button className="end-call" title="End call" onClick={endCall}><PhoneOff size={18} /></button></div>}</section></div>}
  </>;
}
