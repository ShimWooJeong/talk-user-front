import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { OpenVidu } from 'openvidu-browser';
import OpenViduVideo from './OpenViduVideo';
import { apiCall, apiCallWithFileData } from '../../utils/apiCall';
import { API_LIST } from '../../utils/apiList';
import { getToken, getTokenForTest } from '../../services/openviduService';
import io from 'socket.io-client';
import RaccoonHand from '../../components/common/RaccoonHand';
import MovingDogs from './MovingDogs';
import logo from '../../assets/barking-talk.png'; // 로고 이미지 경로
import AIimg from '../../assets/ai.png'; // AI 이미지 추가
import start_sound from '../../assets/sounds/start.mp3';
import correct_sound from '../../assets/sounds/correct.mp3';
import wrong_sound from '../../assets/sounds/wrong.mp3';
import topic_sound from '../../assets/sounds/topic.mp3';

const VideoChatPage = () => {
    const FRAME_RATE = 10;
    const location = useLocation();
    const sessionId = new URLSearchParams(location.search).get('sessionId');
    const recognitionRef = useRef(null);
    const socket = useRef(null);

    const [session, setSession] = useState(undefined);
    const [subscribers, setSubscribers] = useState([]);
    const [publisher, setPublisher] = useState(undefined);
    const [showSettings, setShowSettings] = useState(false); // 설정 창 상태 관리
    const [recommendedTopics, setRecommendedTopics] = useState([]); // 주제 추천 결과 저장
    const [isLeaving, setIsLeaving] = useState(false); // 중단 중복 호출 방지
    const [sessionData, setSessionData] = useState(null);
    const [OV, setOV] = useState(null); // OpenVidu 객체 상태 추가
    const [quizTime, setQuizTime] = useState(0); // 퀴즈 타이머 상태
    const [quizMode, setQuizMode] = useState(false); // 퀴즈 모드 상태 추가
    const [quizChallenger, setQuizChallenger] = useState(''); // 퀴즈 도전자
    const [quizResult, setQuizResult] = useState(''); // 퀴즈미션 결과 (성공/실패)
    const [quizResultTrigger, setQuizResultTrigger] = useState(0);
    const [isChallengeCompleted, setIsChallengeCompleted] = useState(false); // 미션 종료 여부
    const [isChallengeCompletedTrigger, setIsChallengeCompletedTrigger] =
        useState(0);

    const [quizInProgress, setQuizInProgress] = useState(false);
    const [quizQuestion, setQuizQuestion] = useState('');
    const [quizAnswer, setQuizAnswer] = useState('');
    const quizQuestionRef = useRef('');
    const quizAnswerRef = useRef('');

    const [showInitialModal, setShowInitialModal] = useState(true);
    const [showQuizSuccess, setShowQuizSuccess] = useState(false);
    const [showQuizFailure, setShowQuizFailure] = useState(false);

    const quizModeRef = useRef(quizMode);
    const targetUserIndexRef = useRef(0);
    const [isTTSActive, setIsTTSActive] = useState(false); // TTS 활성화 상태를 저장하는 변수

    const [speechLengths, setSpeechLengths] = useState([]);
    const [speakingUsers, setSpeakingUsers] = useState(new Set());

    //AI 응답 모달 상태
    const [isAnswerModalOpen, setIsAnswerModalOpen] = useState(false);
    const [aiResponse, setAiResponse] = useState('');

    const [isRecommending, setIsRecommending] = useState(false);

    const [isMissionInProgress, setIsMissionInProgress] = useState(false);

    // targetUserIndex 상태 추가
    const [targetUserIndex, setTargetUserIndex] = useState(null);

    const handleQuizInProgress = (payload) => {
        console.log('자식컴포넌트로부터 넘겨받은 데이터 -> ', payload);
        setIsMissionInProgress(true);
        setSession((currentSession) => {
            if (currentSession) {
                currentSession.signal({
                    data: JSON.stringify({
                        userId: userInfo.username,
                        message: `${userInfo.username} 유저가 미션을 시작합니다.`,
                        nickname: userInfo.nickname,
                        quizQuestion: quizQuestionRef.current,
                    }),
                    to: [],
                    type: 'quizStart',
                });
                speakText(`${userInfo.nickname} 유저가 미션을 시작합니다.`);
            } else {
                console.error('퀴즈 미션수행 에러');
            }
            return currentSession;
        });
    };
    const finishQuizMission = () => {
        setIsMissionInProgress(false);
        session.signal({
            data: JSON.stringify({
                userId: userInfo.username,
                message: `${userInfo.username} 유저가 미션을 종료합니다.`,
                result: false,
            }),
            to: [],
            type: 'quizEnd',
        });
    };

    useEffect(() => {
        if (sessionData && sessionData.length >= 1) {
            setShowInitialModal(true);
            const timer = setTimeout(() => {
                setShowInitialModal(false);
            }, 5000); // 5초 후 모달 닫기

            return () => clearTimeout(timer);
        }
    }, [sessionData]);

    useEffect(() => {
        if (quizChallenger && quizChallenger === userInfo.username) {
            checkAnswer();
        }
    }, [quizChallenger]);

    const userInfo = useSelector((state) => state.user.userInfo); // redux에서 유저 정보 가져오기

    // userInfo가 null인 경우 처리
    if (!userInfo) {
        return <div>Loading...</div>;
    }

    const [remainingTime, setRemainingTime] = useState(300); // 디폴트 타이머 5분

    useEffect(() => {
        let timer;

        const fetchTimer = async () => {
            const result = await apiCall(API_LIST.GET_SESSION_TIMER, {
                sessionId,
            });
            if (result.status) {
                const leftTime = result.data.remainingTime;
                setRemainingTime(leftTime);

                // fetchTimer 완료 후 setInterval 시작
                timer = setInterval(() => {
                    setRemainingTime((prevTime) => {
                        if (prevTime <= 0) {
                            clearInterval(timer);
                            return 0;
                        }
                        return prevTime - 1;
                    });
                }, 1000);
            }
        };

        fetchTimer();

        return () => {
            if (timer) {
                clearInterval(timer);
            }
        };
    }, []);

    useEffect(() => {
        const fetchSessionData = async () => {
            try {
                const response = await apiCall(API_LIST.GET_SESSION_DATA, {
                    sessionId,
                });
                setSessionData(response.data); // 상태에 저장
                console.log('----------SESSIONDATA: ', response);
            } catch (error) {
                console.error('Error fetching session data:', error);
            }
        };

        fetchSessionData();
    }, []); // sessionId 의존성 제거

    // socket 연결 처리
    useEffect(() => {
        socket.current = io(import.meta.env.VITE_API_URL);

        socket.current.on('connect', () => {
            console.log('WebSocket connection opened');
        });

        socket.current.on('disconnect', () => {
            console.log('WebSocket connection closed');
        });

        // 주제 추천 결과 이벤트 수신
        // 결과 데이터 수신 받아와 변수에 저장 후 상태 업데이트
        socket.current.on('topicRecommendations', (data) => {
            console.log('Received topic recommendations:', data);
            setRecommendedTopics((prevTopics) => [...prevTopics, data.trim()]);
            const audio = new Audio(topic_sound);
            audio.play();
            setTimeout(() => {
                speakText('해당 주제에 대해 얘기해보는 건 어떠세요?');
            }, 2000);

            // 5초후에 모달 닫기
            setTimeout(() => {
                setRecommendedTopics([]);
            }, 5000);
        });

        socket.current.on('answerRecommendations', (data) => {
            console.log('Received AI Answer:', data);
            setAiResponse((prevAnswer) => [...prevAnswer, data.trim()]);

            // 5초후에 모달 닫기
            setTimeout(() => {
                setIsAnswerModalOpen(true);
                speakText(data);
            }, 5000);
        });

        socket.current.on('endOfStream', () => {
            console.log('Streaming ended');
        });

        // 주기적으로 발화량 계산 요청 보내기
        const interval = setInterval(() => {
            console.log('발화량 계산 요청 보내기');
            socket.current.emit('requestSpeechLengths', { sessionId });
        }, 30000); // 1분 (60000 밀리초) 단위로 실행

        // 발화량 순위 데이터 수신
        socket.current.on('speechLengths', (data) => {
            console.log('발화량 순위 데이터 수신:', data);
            setSpeechLengths(data); // 직접 받은 데이터를 그대로 사용
            sessionStorage.setItem('ranking', JSON.stringify(data));
        });

        return () => {
            if (socket.current) {
                socket.current.emit('leaveSession', sessionId);
                socket.current.disconnect();
            }
            clearInterval(interval);
        };
    }, [location, sessionId]);

    // TODO: 세션 떠날 때 Redis session방에서 해당 유저 없애도록 요청하기
    // 세션 떠남
    const leaveSession = useCallback(async () => {
        if (isLeaving) {
            // 중복 중단 막기
            return;
        }
        setIsLeaving(true);

        // openVidu 세션에서 연결 해제
        if (session) {
            session.disconnect();
        }

        // 음성인식 종료
        if (recognitionRef.current) {
            try {
                recognitionRef.current.stop();
            } catch (error) {
                console.error('음성인식 종료 오류:', error);
            }
            recognitionRef.current.onend = null;
            recognitionRef.current = null;
        }

        // 사용자 카메라 & 마이크 비활성화
        if (publisher) {
            const mediaStream = publisher.stream.getMediaStream();
            if (mediaStream && mediaStream.getTracks) {
                // 모든 미디어 트랙 중지
                mediaStream.getTracks().forEach((track) => track.stop());
            }
        }

        const nickname = userInfo.nickname;

        console.log('중단하기 요청 전송:', { nickname, sessionId });

        try {
            // 기존 leaveSession 로직
            const response = await apiCall(API_LIST.END_CALL, {
                nickname,
                sessionId,
            });

            console.log('API 응답:', response);

            // 피드백 결과를 sessionStorage에 저장
            if (response.status) {
                sessionStorage.setItem('feedback', response.data.feedback);
            }

            // 소켓 연결을 끊고 세션을 정리
            if (socket.current) {
                socket.current.emit('leaveSession', sessionId);
                socket.current.disconnect();
            }

            setSession(undefined);
            setSubscribers([]);
            setPublisher(undefined);
            setOV(null);

            // 세션 ID를 sessionStorage에 저장
            sessionStorage.setItem('sessionId', sessionId);
            sessionStorage.setItem('fromVideoChat', 'true'); // 플래그 설정

            window.location.href = '/review';
        } catch (error) {
            console.error('Error ending call:', error);
        } finally {
            setIsLeaving(false);
        }
    }, [session, publisher, userInfo.nickname, location.search, isLeaving]);

    const startStreaming = async (session, OV, mediaStream, pitchValue) => {
        // 2초 대기
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const video = document.createElement('video');
        video.srcObject = mediaStream;
        video.autoplay = true;
        video.playsInline = true;

        // 너구리 캔버스를 한 번만 가져옴
        const avatarCanvas = document
            .getElementById('avatar_canvas')
            .querySelector('div')
            .querySelector('canvas');

        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = 1280;
        compositeCanvas.height = 720;

        const ctx = compositeCanvas.getContext('2d');

        let animationFrameId;

        const render = () => {
            ctx.drawImage(
                video,
                0,
                0,
                compositeCanvas.width,
                compositeCanvas.height
            );
            ctx.drawImage(
                avatarCanvas,
                0,
                0,
                compositeCanvas.width,
                compositeCanvas.height
            );
            animationFrameId = requestAnimationFrame(render);
        };

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                render();
                resolve();
            };
        });

        const compositeStream = compositeCanvas.captureStream(FRAME_RATE);

        const publisher = OV.initPublisher(undefined, {
            audioSource: mediaStream.getAudioTracks()[0],
            videoSource: compositeStream.getVideoTracks()[0],
            frameRate: FRAME_RATE,
            videoCodec: 'H264',
        });

        setPublisher(publisher);
        await session.publish(publisher);

        startSpeechRecognition(
            publisher.stream.getMediaStream(),
            userInfo.nickname
        );

        socket.current.emit('joinSession', sessionId);

        // 컴포넌트 언마운트 시 정리 함수 반환
        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
        };
    };

    const updatePublisherWithNewPitch = (pitchValue) => {
        if (publisher && session) {
            // 기존 퍼블리셔 스트림 중지 및 새로운 피치 값으로 새롭게 퍼블리시
            if (publisher.stream) {
                session
                    .unpublish(publisher)
                    .then(() => {
                        startStreaming(
                            session,
                            OV,
                            publisher.stream.getMediaStream(),
                            pitchValue
                        );
                    })
                    .catch((error) => {
                        console.error('Error unpublishing:', error);
                    });
            } else {
                startStreaming(
                    session,
                    OV,
                    publisher.stream.getMediaStream(),
                    pitchValue
                );
            }
        }
    };

    // 세션 참여
    const joinSession = useCallback(
        async (sid) => {
            const audio = new Audio(start_sound);
            audio.play();
            speakText(` m b t i를 맞춰보세요!`);
            const OV = new OpenVidu();
            setOV(OV); // OV 객체 상태로 설정
            const session = OV.initSession();
            setSession(session);

            session.on('streamCreated', (event) => {
                let subscriber = session.subscribe(event.stream, undefined);
                setSubscribers((prevSubscribers) => [
                    ...prevSubscribers,
                    subscriber,
                ]);
            });

            // 퀴즈 미션 시작
            session.on('signal:quizStart', (event) => {
                setIsChallengeCompleted(false);
                setQuizInProgress(true);
                const data = JSON.parse(event.data);
                console.log('quizStart 시그널 전달받음, 내용은? -> ', data);

                // recognition.start();
                setQuizChallenger((prevQuizChallenger) => {
                    if (prevQuizChallenger === '') {
                        return data.userId;
                    }
                    return prevQuizChallenger;
                });

                setQuizQuestion(data.quizQuestion);
            });

            // 퀴즈 미션 종료
            session.on('signal:quizEnd', (event) => {
                const data = JSON.parse(event.data);
                console.log('quizEnd 시그널 전달받음, 내용은? -> ', data);
                setQuizInProgress(false);

                // 타인의 결과에 의한 미션 결과
                // 정답인 경우
                if (data.result === true) {
                    setQuizAnswer(data.quizAnswer);
                    setShowQuizSuccess(true);
                    const audio = new Audio(correct_sound);
                    audio.play();
                    setTimeout(() => {
                        speakText('미션 성공!');
                    }, 3000);
                } else {
                    // 오답인 경우
                    setShowQuizFailure(true);
                    const audio = new Audio(wrong_sound);
                    audio.play();
                    setTimeout(() => {
                        speakText('미션 실패!');
                    }, 1000);
                }

                // 본인의 결과에 의한 미션 결과
                if (data.userId === userInfo.username) {
                    if (data.result) {
                        // 미션성공
                        setQuizResult('success');
                        setQuizResultTrigger((prev) => prev + 1);
                    } else {
                        // 미션실패
                        setQuizResult('failure');
                        setQuizResultTrigger((prev) => prev + 1);
                    }
                }

                setTimeout(() => {
                    setIsChallengeCompleted(true);
                    setIsChallengeCompletedTrigger((prev) => prev + 1);

                    setQuizChallenger(''); // 퀴즈 도전자 초기화
                    setQuizResult(''); // 퀴즈 결과 초기화

                    setShowQuizSuccess(false);
                    setShowQuizFailure(false);
                }, 5000);
            });

            // 세션 연결 종료 시 (타이머 초과에 의한 종료)
            session.on('sessionDisconnected', (event) => {
                console.log('Session disconnected:', event);
                leaveSession();
            });

            session.on('streamDestroyed', (event) => {
                setSubscribers((prevSubscribers) =>
                    prevSubscribers.filter(
                        (sub) => sub !== event.stream.streamManager
                    )
                );
            });

            // 발화 시작 감지
            session.on('publisherStartSpeaking', (event) => {
                console.log(
                    'User ' + event.connection.connectionId + ' start speaking'
                );
                // resetInactivityTimer(); // Reset inactivity timer on speech detected
                setSpeakingUsers((prev) =>
                    new Set(prev).add(event.connection.connectionId)
                );
            });

            // 발화 종료 감지
            session.on('publisherStopSpeaking', (event) => {
                console.log(
                    'User ' + event.connection.connectionId + ' stop speaking'
                );
                // startInactivityTimer(); // Start inactivity timer on speech stop detected
                setSpeakingUsers((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(event.connection.connectionId);
                    return newSet;
                });
            });

            const allowedSessionIdList = [
                'sessionA',
                'sessionB',
                'sessionC',
                'sessionD',
                'sessionE',
                'sessionF',
                'sessionG',
                'sessionH',
            ];
            if (!allowedSessionIdList.includes(sessionId)) {
                getToken(sid, userInfo).then((token) => {
                    session
                        .connect(token)
                        .then(() => {
                            OV.getUserMedia({
                                audioSource: false,
                                videoSource: undefined,
                                // resolution: '1280x720',
                                resolution: '640x480',
                                frameRate: FRAME_RATE,
                            }).then((mediaStream) => {
                                startStreaming(session, OV, mediaStream);
                            });
                        })
                        .catch((error) => {
                            console.log(
                                'There was an error connecting to the session:',
                                error.code,
                                error.message
                            );
                        });
                });
            } else {
                getTokenForTest(sid, userInfo).then((token) => {
                    session
                        .connect(token)
                        .then(() => {
                            OV.getUserMedia({
                                audioSource: false,
                                videoSource: undefined,
                                // resolution: '1280x720',
                                resolution: '640x480',
                                frameRate: FRAME_RATE,
                            }).then((mediaStream) => {
                                startStreaming(session, OV, mediaStream);
                            });
                        })
                        .catch((error) => {
                            console.log(
                                'There was an error connecting to the session:',
                                error.code,
                                error.message
                            );
                        });
                });
            }
        },
        [userInfo.username]
    );

    // 설정 창 표시/숨기기 토글 함수
    const toggleSettings = () => {
        setShowSettings(!showSettings);
    };

    // 비디오 좌우반전 처리 (SettingMenu 자식 컴포넌트 핸들러)
    const handleMirrorChange = (mirrorState) => {
        setIsMirrored(mirrorState);
    };

    // useEffect 내의 beforeunload 이벤트 리스너 추가
    useEffect(() => {
        const handleBeforeUnload = (event) => {
            if (!isLeaving) {
                leaveSession();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [leaveSession, isLeaving]);

    useEffect(() => {
        // URL에서 sessionId 파라미터를 가져옵니다.
        joinSession(sessionId);
    }, [location, joinSession]);

    // 텍스트 데이터를 서버로 전송하는 함수
    const sendTranscription = (nickname, transcript) => {
        console.log('transcript: ', transcript);
        const sessionId = new URLSearchParams(location.search).get('sessionId');
        if (!transcript || transcript == '') {
            // 인식된 게 없으면 전송 x
            console.log('Transcript is empty or null:', transcript);
            return;
        }
        console.log('서버로 전송: ', { nickname, transcript, sessionId });
        apiCall(API_LIST.RECEIVE_TRANSCRIPT, {
            nickname,
            transcript,
            sessionId,
        })
            .then((data) => {
                console.log('Transcript received:', data);
            })
            .catch((error) => {
                console.error('Error sending transcript:', error);
            });
    };

    // 주제 추천 요청 이벤트 발생
    const requestTopicRecommendations = () => {
        if (isRecommending) return; // 이미 추천 중이면 중복 요청 방지
        setIsRecommending(true);
        console.log(`${sessionId}에서 주제추천 요청`);
        socket.current.emit('requestTopicRecommendations', { sessionId });
    };

    // AI 클릭 핸들러 수정 - 실제로 AI 응답을 받아오는 함수
    const requestAIAnswer = async () => {
        console.log(`${sessionId}에서 AI 응답 요청`);
        socket.current.emit('requestAIAnswer', { sessionId });
    };

    // 음성인식 시작
    const startSpeechRecognition = (stream, nickname) => {
        // 브라우저 지원 확인
        if (!('webkitSpeechRecognition' in window)) {
            console.error('speech recognition을 지원하지 않는 브라우저');
            return;
        }

        //SpeechRecognition 객체 생성 및 옵션 설정
        const recognition = new window.webkitSpeechRecognition();
        recognition.continuous = true; // 연속적인 음성인식
        recognition.interimResults = false; // 중간 결과 처리

        recognition.onstart = () => {
            console.log('Speech recognition started');
        };

        recognition.onresult = (event) => {
            console.log('in onresult');
            // 음성인식 결과가 도출될 때마다 인식된 음성 처리(stt)
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    const transcript = event.results[i][0].transcript;
                    console.log('Mozilla result:', {
                        nickname,
                        transcript,
                    });
                    sendTranscription(nickname, transcript);
                    setSttResults((prevResults) => [
                        ...prevResults,
                        transcript,
                    ]);

                    // 퀴즈 모드일 때만 quizAnswer 검사
                    if (quizModeRef.current) {
                        if (
                            containsPattern(transcript, quizAnswerRef.current)
                        ) {
                            console.log('정답입니다!');
                            setQuizMode(false); // 퀴즈 모드 해제
                            quizModeRef.current = false; // ref 상태 업데이트
                            setQuizTime(0); // 타이머 초기화

                            setSession((currentSession) => {
                                if (currentSession) {
                                    currentSession.signal({
                                        data: JSON.stringify({
                                            userId: userInfo.username,
                                            message: `${userInfo.username} 유저 미션 종료`,
                                            result: true,
                                            quizAnswer: quizAnswerRef.current,
                                        }),
                                        to: [],
                                        type: 'quizEnd',
                                    });
                                } else {
                                    console.error('퀴즈 미션수행 에러');
                                }
                                return currentSession;
                            });
                        }
                    }
                }
            }
        };

        recognition.onend = () => {
            console.log('Speech recognition ended');
            if (recognitionRef.current) {
                recognition.start();
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (event.error !== 'no-speech') {
                try {
                    recognition.stop(); // 현재 인식을 멈추고 재시작
                    recognition.start();
                } catch (error) {
                    console.error(
                        'Error starting speech recognition again:',
                        error
                    );
                }
            }
        };

        try {
            // 음성인식 시작
            recognition.start();
            recognitionRef.current = recognition;
        } catch (error) {
            console.error('Error starting speech recognition:', error);
        }
    };

    function containsPattern(text, pattern) {
        // 디버깅을 위한 로그
        console.log(`text: '${text}', pattern: '${pattern}'`);

        // text와 pattern이 undefined일 경우 빈 문자열로 설정 처리
        text = text || '';
        pattern = pattern || '';

        // text와 pattern을 소문자로 변환
        text = text.toLowerCase();
        pattern = pattern.toLowerCase();

        // text와 pattern의 모든 공백 제거
        text = text.replace(/\s+/g, '');
        pattern = pattern.replace(/\s+/g, '');

        // 공백 전처리 후 빈 문자열 처리
        if (pattern.length === 0) return true;
        if (text.length === 0) return false;

        console.log(`trim-text: '${text}', trim-pattern: '${pattern}'`);

        // 패턴이 텍스트에 포함되어 있는지 확인
        const result = text.includes(pattern);

        console.log(result ? '성공' : '실패');
        return result;
    }

    // 퀴즈 음성인식 결과를 체크하는 함수
    const checkAnswer = () => {
        setQuizMode(true); // 퀴즈 모드 활성화
        quizModeRef.current = true; // ref 상태 업데이트
        console.log('Quiz 모드: ', quizModeRef.current);

        setQuizTime(10);

        const intervalId = setInterval(() => {
            setQuizTime((prevTime) => {
                if (prevTime <= 0) {
                    clearInterval(intervalId);
                    if (quizModeRef.current) {
                        console.log('오답입니다!');
                        finishQuizMission();
                        setQuizMode(false);
                        quizModeRef.current = false;
                    }
                    return 0;
                }
                console.log(`남은 시간: ${prevTime - 1}초`);
                return prevTime - 1;
            });
        }, 1000);
    };

    const maskMBTI = (mbti) => {
        if (mbti.length !== 4) return mbti;
        return `${mbti[0]}--${mbti[3]}`;
    };

    const InitialQuestionModal = () => {
        if (!sessionData || sessionData.length < 4) return null;
        const currentUserIndex = sessionData.findIndex(
            (user) => user.userId === userInfo.username
        );

        const newTargetUserIndex = (currentUserIndex + 1) % 4;
        setTargetUserIndex(newTargetUserIndex); // 상태 업데이트

        quizQuestionRef.current =
            sessionData[newTargetUserIndex].nickname + '님의 MBTI는 뭘까요?';

        const answer = sessionData[newTargetUserIndex].mbti;
        quizAnswerRef.current = answer;
        console.log('answer는? -> ', quizAnswerRef.current);

        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-gradient-to-br from-yellow-100 to-orange-100 p-8 sm:p-12 lg:p-16 rounded-2xl shadow-2xl max-w-sm sm:max-w-lg lg:max-w-2xl w-full text-center transform transition-transform scale-105 hover:scale-110">
                    <h2 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold mb-6 sm:mb-8 lg:mb-10 text-orange-800">
                        답변을 맞출 대상
                    </h2>
                    <p className="mb-6 sm:mb-8 lg:mb-10 text-2xl sm:text-4xl lg:text-5xl text-orange-700">
                        <span className="font-semibold text-orange-800">
                            "{sessionData[newTargetUserIndex].nickname}"
                        </span>{' '}
                        님에 대한 MBTI를 맞춰보세요.
                    </p>
                    <p className="mb-6 sm:mb-8 lg:mb-10 font-bold text-3xl sm:text-5xl lg:text-5xl text-orange-800 bg-orange-200 p-6 sm:p-8 lg:p-10 rounded-lg shadow-inner">
                        MBTI 힌트 : "
                        {maskMBTI(sessionData[newTargetUserIndex].mbti)}"
                    </p>
                    <p className="text-lg sm:text-2xl lg:text-3xl text-orange-500">
                        이 창은 5초 후 자동으로 닫힙니다.
                    </p>
                </div>
            </div>
        );
    };

    const speakText = (text, delay) => {
        if (isTTSActive) {
            return; // TTS가 이미 실행 중인 경우 함수 종료
        }

        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'ko-KR'; // 언어 설정 (한국어)
            utterance.rate = 1.2; // 말하기 속도 조절 (기본값: 1)
            utterance.pitch = 0.6; // 음조 조절 (기본값: 1)

            const voices = window.speechSynthesis.getVoices();
            const selectedVoice = voices.find((voice) =>
                voice.name.includes('Google 한국의')
            );

            if (selectedVoice) {
                utterance.voice = selectedVoice;
            } else {
                console.warn(
                    `Voice 'Google 한국의' not found. Using default voice.`
                );
            }

            utterance.onstart = () => {
                setIsTTSActive(true); // TTS 시작 시 상태 설정
            };

            utterance.onend = () => {
                setIsTTSActive(false); // TTS 끝날 시 상태 리셋
                closeAnswerModal(); // TTS 끝날 때 모달 닫기
            };

            window.speechSynthesis.speak(utterance);
        } else {
            console.error('This browser does not support speech synthesis.');
        }
    };

    // AI 응답 모달 닫기 함수
    const closeAnswerModal = () => {
        window.speechSynthesis.cancel(); // TTS 중단
        setIsAnswerModalOpen(false);
        setAiResponse(''); // AI 응답 초기화
    };

    return (
        <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#f7f3e9] to-[#e7d4b5]">
            <header className="w-full bg-gradient-to-r from-[#a16e47] to-[#8b5e3c] p-1 flex items-center justify-between shadow-lg">
                <div className="flex items-center space-x-4">
                    <img
                        src={logo}
                        alt="멍톡 로고"
                        className="w-16 h-16 sm:w-60 sm:h-24 rounded-full transform hover:scale-105 transition-transform duration-300"
                        onClick={requestTopicRecommendations}
                    />
                </div>
                <div
                    className="flex items-center"
                    onClick={requestAIAnswer} // AI 클릭 핸들러 추가
                >
                    <img
                        src={AIimg}
                        alt="AI 응답"
                        className="w-16 h-16 sm:w-20 sm:h-20 rounded-full transform hover:scale-105 transition-transform duration-300"
                    />
                </div>
                <div className="flex items-center">
                    <h2 className="text-white text-4xl font-bold bg-[#8b5e3c] bg-opacity-80 rounded-lg px-5 py-3 mr-5 shadow-inner">
                        남은 시간: {Math.floor(remainingTime / 60)}분{' '}
                        {remainingTime % 60}초
                    </h2>
                    <button
                        onClick={leaveSession}
                        className="text-white text-3xl bg-gradient-to-r from-red-500 to-red-600 px-7 py-3 rounded-lg hover:from-red-600 hover:to-red-700 transition-colors duration-300 shadow-lg transform hover:scale-105"
                    >
                        중단하기
                    </button>
                </div>
            </header>
            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex flex-col w-3/4 bg-gradient-to-br from-[#fff8e8] to-[#fff2d6] border-r border-[#d4b894] shadow-inner">
                    <RaccoonHand
                        onQuizEvent={handleQuizInProgress}
                        quizResult={quizResult}
                        quizResultTrigger={quizResultTrigger}
                        isChallengeCompleted={isChallengeCompleted}
                        isChallengeCompletedTrigger={
                            isChallengeCompletedTrigger
                        }
                    />
                    <div className="grid grid-cols-2 grid-rows-2 gap-2 p-2 h-full">
                        {publisher && (
                            <div
                                className={`relative w-full h-full border-4 ${
                                    speakingUsers.has(
                                        publisher.stream.connection.connectionId
                                    )
                                        ? 'border-blue-500'
                                        : 'border-transparent'
                                } rounded-xl shadow-lg overflow-hidden transition-all duration-300`}
                            >
                                <OpenViduVideo
                                    streamManager={publisher}
                                    className="w-full h-full object-cover"
                                />

                                <div className="absolute top-0 left-0 right-0 z-10 bg-white bg-opacity-30">
                                    <div className="flex justify-center items-center w-full py-2 sm:py-3">
                                        <span className="text-4xl sm:text-5xl md:text-6xl tracking-widest font-extrabold text-black px-6">
                                            {
                                                JSON.parse(
                                                    publisher.stream.connection
                                                        .data
                                                ).nickname
                                            }
                                        </span>
                                    </div>
                                </div>

                                {quizChallenger ===
                                    JSON.parse(publisher.stream.connection.data)
                                        .userId &&
                                    quizInProgress && (
                                        <div className="absolute top-0 left-0 w-full bg-black/75 text-white py-4 px-6 rounded-b-xl shadow-lg border-x-2 border-b-2 border-yellow-400 z-20">
                                            <div className="flex flex-col items-center justify-center space-y-2">
                                                <div className="overflow-hidden w-full">
                                                    <p className="text-5xl font-extrabold text-white whitespace-nowrap animate-[slideLeft_10s_linear_infinite] drop-shadow-[0_0_10px_rgba(255,255,255,0.7)] tracking-wide">
                                                        {
                                                            sessionData[
                                                                targetUserIndexRef
                                                                    .current
                                                            ].nickname
                                                        }
                                                        님의 MBTI는 뭘까요?
                                                    </p>
                                                </div>
                                                <p className="text-3xl font-bold text-yellow-300 animate-pulse whitespace-nowrap drop-shadow-[0_0_10px_rgba(255,255,0,0.7)] tracking-wide">
                                                    🔥 미션 진행 중!!
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                <style jsx>{`
                                    @keyframes slideLeft {
                                        0% {
                                            transform: translateX(100%);
                                        }
                                        100% {
                                            transform: translateX(-100%);
                                        }
                                    }
                                `}</style>

                                <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-r from-[#a16e47] to-[#8b5e3c] py-2 sm:py-3">
                                    <div className="flex justify-center items-center w-full">
                                        {sessionData
                                            .find(
                                                (user) =>
                                                    user.userId ===
                                                    userInfo.username
                                            )
                                            ?.userInterests.slice(0, 3)
                                            .map((interest, index) => (
                                                <span
                                                    key={index}
                                                    className="text-2xl sm:text-3xl md:text-4xl px-6 sm:px-8 py-1 sm:py-1 bg-[#d4b894] text-[#4a3728] font-bold rounded-full mx-3 whitespace-nowrap transform transition-all duration-300 hover:scale-105 hover:bg-[#e7d4b5] tracking-wide"
                                                >
                                                    {interest}
                                                </span>
                                            ))}
                                    </div>
                                </div>
                            </div>
                        )}
                        {subscribers.map((subscriber, index) => (
                            <div
                                key={index}
                                className={`relative w-full h-full border-4 ${
                                    speakingUsers.has(
                                        subscriber.stream.connection
                                            .connectionId
                                    )
                                        ? 'border-blue-500'
                                        : 'border-transparent'
                                } rounded-xl shadow-lg overflow-hidden transition-all duration-300`}
                            >
                                <OpenViduVideo
                                    streamManager={subscriber}
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute top-0 left-0 right-0 z-10 bg-white bg-opacity-30">
                                    <div className="flex justify-center items-center w-full py-2 sm:py-3">
                                        <span className="text-4xl sm:text-5xl md:text-6xl tracking-widest font-extrabold text-black px-6">
                                            {subscriber.stream.connection
                                                .data &&
                                                JSON.parse(
                                                    subscriber.stream.connection
                                                        .data
                                                ).nickname}
                                        </span>
                                    </div>
                                </div>

                                {subscriber.stream.connection.data &&
                                    quizChallenger ===
                                        JSON.parse(
                                            subscriber.stream.connection.data
                                        ).userId &&
                                    quizInProgress && (
                                        <div className="absolute top-0 left-0 w-full bg-black/75 text-white py-4 px-6 rounded-b-xl shadow-lg border-x-2 border-b-2 border-yellow-400 z-20">
                                            <div className="flex flex-col items-center justify-center space-y-2">
                                                <div className="overflow-hidden w-full">
                                                    <p className="text-5xl font-extrabold text-white whitespace-nowrap animate-[slideLeft_10s_linear_infinite] drop-shadow-[0_0_10px_rgba(255,255,255,0.7)] tracking-wide">
                                                        {
                                                            sessionData[
                                                                targetUserIndexRef
                                                                    .current
                                                            ].nickname
                                                        }
                                                        님의 MBTI는 뭘까요?
                                                    </p>
                                                </div>
                                                <p className="text-3xl font-bold text-yellow-300 animate-pulse whitespace-nowrap drop-shadow-[0_0_10px_rgba(255,255,0,0.7)] tracking-wide">
                                                    🔥 미션 진행 중!
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-r from-[#a16e47] to-[#8b5e3c] py-2 sm:py-3">
                                    <div className="flex justify-center items-center w-full">
                                        {subscriber.stream.connection.data &&
                                            sessionData
                                                .find(
                                                    (user) =>
                                                        user.nickname ===
                                                        JSON.parse(
                                                            subscriber.stream
                                                                .connection.data
                                                        ).nickname
                                                )
                                                ?.userInterests.slice(0, 3)
                                                .map((interest, index) => (
                                                    <span
                                                        key={index}
                                                        className="text-2xl sm:text-3xl md:text-4xl px-6 sm:px-8 py-1 sm:py-1 bg-[#d4b894] text-[#4a3728] font-bold rounded-full mx-3 whitespace-nowrap transform transition-all duration-300 hover:scale-105 hover:bg-[#e7d4b5] tracking-wide"
                                                    >
                                                        {interest}
                                                    </span>
                                                ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                        {Array.from({
                            length:
                                4 - subscribers.length - (publisher ? 1 : 0),
                        }).map((_, index) => (
                            <div
                                key={`empty-${index}`}
                                className="relative w-full h-full border-3 border-[#d4b894] rounded-xl shadow-2xl flex items-center justify-center bg-gradient-to-br from-[#f7f3e9] to-[#e7d4b5]"
                            >
                                <div className="text-[#8b5e3c] flex flex-col items-center">
                                    <svg
                                        className="animate-spin-slow h-32 w-32 text-[#8b5e3c] mb-6"
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                    >
                                        <circle
                                            className="opacity-25"
                                            cx="12"
                                            cy="12"
                                            r="10"
                                            stroke="currentColor"
                                            strokeWidth="4"
                                        ></circle>
                                        <path
                                            className="opacity-75"
                                            fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                        ></path>
                                    </svg>
                                    <span className="text-4xl font-extrabold text-[#8b5e3c] animate-pulse">
                                        로딩 중...!
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="w-1/4 flex flex-col p-5 bg-gradient-to-b bg-white shadow-inner relative ">
                    <MovingDogs
                        sessionData={sessionData}
                        speechLengths={speechLengths}
                        targetUserIndex={targetUserIndex} // 새로운 prop 전달
                    />

                    <div
                        className="w-full flex flex-col items-center absolute"
                        style={{ top: '400px', left: '4px' }}
                    >
                        {recommendedTopics.length > 0 &&
                            !quizChallenger &&
                            !quizResult && (
                                <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
                                    <div className="bg-gradient-to-r from-yellow-200 via-orange-100 to-yellow-200 bg-opacity-80 p-8 rounded-3xl shadow-2xl w-11/12 max-w-8xl h-80 text-center transform transition-all duration-300 scale-100 hover:scale-105 flex items-center justify-between overflow-hidden border-6 border-orange-300 backdrop-filter backdrop-blur-sm">
                                        <div className="flex-1 text-left space-y-6">
                                            <h1 className="text-7xl font-extrabold text-orange-800 animate-pulse">
                                                추천 주제
                                            </h1>
                                        </div>
                                        <div className="flex-[2] font-bold text-5xl text-orange-800 bg-orange-200 bg-opacity-60 p-8 rounded-xl shadow-inner mx-8">
                                            <p className="animate-bounce">
                                                "{recommendedTopics}"
                                            </p>
                                        </div>
                                        <div className="flex-[0.5] text-right">
                                            <p className="text-2xl text-orange-600 animate-pulse">
                                                5초 후 <br></br> 자동으로 닫힘
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                        {showQuizSuccess && (
                            <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
                                <div className="bg-gradient-to-r from-yellow-200 via-orange-100 to-yellow-200 bg-opacity-80 p-12 rounded-3xl shadow-2xl w-11/12 max-w-7xl h-96 text-center transform transition-all duration-300 scale-105 hover:scale-110 flex items-center justify-between overflow-hidden border-6 border-orange-300 backdrop-filter backdrop-blur-sm">
                                    <div className="flex-1 text-left space-y-6">
                                        <h1 className="text-8xl font-extrabold text-orange-800 animate-pulse">
                                            🎉성공
                                        </h1>
                                        <p className="text-5xl text-orange-700">
                                            축하합니다! <br></br>
                                            <span className="font-semibold text-orange-800 text-6xl">
                                                {sessionData.map((item) =>
                                                    item.userId ==
                                                    quizChallenger
                                                        ? item.nickname
                                                        : ''
                                                )}
                                            </span>{' '}
                                            님
                                        </p>
                                    </div>
                                    <div className="flex-1 font-bold text-6xl text-orange-800 bg-orange-200 bg-opacity-60 p-8 rounded-xl shadow-inner mx-8 transform rotate-3">
                                        <p className="animate-bounce">
                                            "{quizAnswer}"
                                        </p>
                                    </div>
                                    <div className="flex-1 text-right space-y-6">
                                        <p className="text-7xl text-orange-700">
                                            멋진 추리력입니다.
                                        </p>
                                        <p className="text-3xl text-orange-600 animate-pulse">
                                            5초 후 자동으로 닫힘
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {showQuizFailure && (
                            <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
                                <div className="bg-gradient-to-r from-yellow-200 via-orange-100 to-yellow-200 bg-opacity-80 p-12 rounded-3xl shadow-2xl w-11/12 max-w-7xl h-96 text-center transform transition-all duration-300 scale-105 hover:scale-110 flex items-center justify-between overflow-hidden border-6 border-orange-300 backdrop-filter backdrop-blur-sm">
                                    <div className="flex-1 text-left space-y-6">
                                        <h1 className="text-8xl font-extrabold text-orange-800 animate-pulse">
                                            😢실패
                                        </h1>
                                        <p className="text-5xl text-orange-700">
                                            아쉽게도 <br />
                                            <span className="font-semibold text-orange-800 text-5xl">
                                                {sessionData.map((item) =>
                                                    item.userId ==
                                                    quizChallenger
                                                        ? item.nickname
                                                        : ''
                                                )}
                                            </span>{' '}
                                            님
                                        </p>
                                    </div>
                                    <div className="flex-1 font-bold text-6xl text-orange-800 bg-orange-200 bg-opacity-60 p-8 rounded-xl shadow-inner mx-8 transform -rotate-3">
                                        <p className="animate-bounce">
                                            오답입니다..
                                        </p>
                                    </div>
                                    <div className="flex-1 text-right space-y-6">
                                        <p className="text-5xl text-orange-700">
                                            다음에 더 잘하실 거예요!
                                        </p>
                                        <p className="text-3xl text-orange-600 animate-pulse">
                                            5초 후 자동으로 닫힘
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {isAnswerModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-3xl shadow-2xl w-11/12 max-w-5xl p-8 text-center transform transition-all duration-300 scale-105 hover:scale-110 border-2 border-gray-300 backdrop-filter backdrop-blur-sm">
                        <h2 className="text-4xl sm:text-7xl font-extrabold mb-6 text-black animate-pulse">
                            🤖 AI 응답
                        </h2>

                        <div className="space-y-6 max-h-[60vh] overflow-y-auto px-4">
                            <p className="text-4xl sm:text-4xl lg:text-4xl font-bold">
                                "{aiResponse}"
                            </p>
                        </div>

                        <button
                            className="mt-8 bg-gradient-to-r from-gray-400 to-gray-600 text-white px-8 py-3 rounded-full text-xl sm:text-2xl font-bold hover:from-gray-500 hover:to-gray-700 transition duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                            onClick={closeAnswerModal} // 모달 닫기 함수 호출
                        >
                            닫기
                        </button>
                    </div>
                </div>
            )}
            {showInitialModal && <InitialQuestionModal />}
        </div>
    );
};
export default VideoChatPage;
