import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

let scene, camera, renderer, currentVrm;
let clock = new THREE.Clock();

// Web Audio API
let audioContext;
let analyser;
let dataArray;
let isTalking = false;

// Animations
let blinkTimer = 0;
let isBlinking = false;
let breatheTime = 0;

export function initVRMAvatar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Renderer (Alpha true for transparent background)
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // Camera
    camera = new THREE.PerspectiveCamera(30.0, container.clientWidth / container.clientHeight, 0.1, 20.0);
    camera.position.set(0.0, 1.3, 1.5); // Adjust for Bust-up

    // Scene
    scene = new THREE.Scene();

    // Lights
    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1.0, 1.0, 1.0).normalize();
    scene.add(light);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);

    // Load VRM
    const loader = new GLTFLoader();
    loader.register((parser) => {
        return new VRMLoaderPlugin(parser);
    });

    loader.load(
        '/avatar.vrm', // You mentioned the file will be placed in public/avatar.vrm
        (gltf) => {
            const vrm = gltf.userData.vrm;
            currentVrm = vrm;
            scene.add(vrm.scene);

            // Rotate 180 deg if model faces backwards by default, though VRM usually faces front
            vrm.scene.rotation.y = Math.PI;

            // Adjust camera to look at the head
            if (vrm.humanoid) {
                const headNode = vrm.humanoid.getNormalizedBoneNode('head');
                if (headNode) {
                    const headPos = new THREE.Vector3();
                    headNode.getWorldPosition(headPos);
                    camera.position.set(0, headPos.y + 0.05, 1.4);
                    camera.lookAt(0, headPos.y + 0.05, 0);
                }
            }

            VRMUtils.removeUnnecessaryJoints(gltf.scene);
        },
        (progress) => { },
        (error) => console.error('VRM Load Error:', error)
    );

    // Resize handler
    window.addEventListener('resize', () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });

    // --- Web Audio API (AnalyserNode) Setup ---
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
    // 【注意】ブラウザの window.speechSynthesis は直接 Web Audio API にルーティングできないため、
    // 今回はAIの発話状態（isTalking）に合わせてAnalyserNodeの波形データをシミュレーションしています。
    // 後日、音声ファイル(.mp3/.wavなど)を再生する方式に変更した際は、
    // 以下のようにつなぎ直すことで完全なリアルタイム波形解析になります：
    // const source = audioContext.createMediaElementSource(audioElement);
    // source.connect(analyser);
    // analyser.connect(audioContext.destination);

    update();
}

export function setTalkingMode(talking) {
    isTalking = talking;
    if (talking && audioContext && audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function update() {
    requestAnimationFrame(update);
    const deltaTime = clock.getDelta();

    if (currentVrm) {
        // 1. Audio Lip Sync (音声リップシンク)
        let volume = 0;

        if (isTalking) {
            // 実際には audio sourceが繋がっていれば analyser.getByteFrequencyData(dataArray) で取得可能
            // analyser.getByteFrequencyData(dataArray); 
            for (let i = 0; i < dataArray.length; i++) {
                dataArray[i] = Math.random() * 255; // シミュレーション波形
            }
        } else {
            dataArray.fill(0);
        }

        // 解析して音の大きさを算出
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        volume = average / 255.0; // 0.0 ~ 1.0

        // 口のブレンドシェイプを動かす (VRM 1.0 は 'aa', VRM 0.x は 'a'。@pixiv/three-vrmはよしなに処理してくれます)
        const expressionName = currentVrm.expressionManager.getExpression('aa') ? 'aa' : 'a';
        currentVrm.expressionManager.setValue(expressionName, volume * 1.5);

        // 2. 呼吸アニメーション (生命感の演出)
        breatheTime += deltaTime;
        // 非常にゆっくりと上下に動く (1息 約4秒周期)
        currentVrm.scene.position.y = Math.sin(breatheTime * (Math.PI / 2)) * 0.01;

        // 3. まばたき (ランダム)
        blinkTimer -= deltaTime;
        if (blinkTimer <= 0) {
            if (isBlinking) {
                currentVrm.expressionManager.setValue('blink', 0);
                isBlinking = false;
                blinkTimer = 2.0 + Math.random() * 4.0; // 2〜6秒待機
            } else {
                currentVrm.expressionManager.setValue('blink', 1);
                isBlinking = true;
                blinkTimer = 0.15; // まばたきの速度(0.15秒)
            }
        }

        currentVrm.update(deltaTime);
    }

    renderer.render(scene, camera);
}
