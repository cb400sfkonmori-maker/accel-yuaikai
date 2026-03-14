import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

let scene, camera, renderer, currentVrm, controls;
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

    // OrbitControls (視点操作)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; // 平行移動を禁止し、中心を固定
    controls.minDistance = 0.5; // 寄りすぎ制限
    controls.maxDistance = 2.0; // 離れすぎ制限
    controls.target.set(0, 1.4, 0); // 回転の中心をアバターの顔〜首の高さに設定
    controls.enableDamping = true; // 操作を滑らかにするための慣性
    controls.dampingFactor = 0.1;
    controls.update(); // 初期設定を適用

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

            // 初期描画バグの修正: シーン追加直後にリサイズを強制発火させ、初回から正しいサイズで描画させる
            requestAnimationFrame(() => {
                window.dispatchEvent(new Event('resize'));
            });

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

                // Tポーズの修正（必須）: 腕を自然に下ろす
                const leftUpperArm = vrm.humanoid.getRawBoneNode('leftUpperArm');
                const rightUpperArm = vrm.humanoid.getRawBoneNode('rightUpperArm');
                if (leftUpperArm) leftUpperArm.rotation.z = 1.2;
                if (rightUpperArm) rightUpperArm.rotation.z = -1.2;
                
                // 初回描画時にTポーズが一瞬見えないよう、強制的に姿勢を初期更新する
                vrm.update(0);
            }

            VRMUtils.removeUnnecessaryJoints(gltf.scene);

            // ロード完了時に Loading UI をフェードアウト
            const loadingUI = document.getElementById('avatar-loading');
            if (loadingUI) {
                loadingUI.style.opacity = '0';
                setTimeout(() => loadingUI.style.display = 'none', 500);
            }
        },
        (progress) => { },
        (error) => {
            console.error('VRM Load Error:', error);
            const loadingUI = document.getElementById('avatar-loading');
            if (loadingUI) loadingUI.innerText = '読み込み失敗';
        }
    );

    // Resize Observer (最強のレスポンシブ処理)
    // キャンバスの親要素（container）のサイズが変更されたり、DOMレイアウト完了時に即座に追従して更新します。
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height);
            }
        }
    });
    resizeObserver.observe(container);

    // ここでの AudioContext 自動初期化を削除（スマホの自動再生ブロック回避のため、ユーザー操作時に実行）

    update();
}

export async function initAudio() {
    if (audioContext) {
        if (audioContext.state === 'suspended') await audioContext.resume();
        return;
    }

    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.frequencyBinCount);

        // スマホ対策・マイクへのアクセス要求（ユーザーアクション内で行う）
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        
        if (audioContext.state === 'suspended') await audioContext.resume();
    } catch (e) {
        console.warn('Mic access denied or error:', e);
    }
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

    // カメラ操作の滑らかな更新
    if (controls) controls.update();

    if (currentVrm) {
        // 1. Audio Lip Sync (音声リップシンク)
        let volume = 0;

        if (analyser && dataArray) {
            if (isTalking) {
                // AIが話している時のシミュレーション
                for (let i = 0; i < dataArray.length; i++) {
                    dataArray[i] = Math.random() * 255;
                }
            } else {
                // マイクからのリアルタイム波形
                analyser.getByteFrequencyData(dataArray);
            }

            // 解析して音の大きさを算出
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            
            if (!isTalking && average < 5) {
                // ノイズ対策のしきい値
                volume = 0;
            } else {
                volume = average / 255.0; // 0.0 ~ 1.0
            }
        }

        // 口のブレンドシェイプを動かす (VRM 1.0 は 'aa', VRM 0.x は 'a'。@pixiv/three-vrmはよしなに処理してくれます)
        const expressionName = currentVrm.expressionManager.getExpression('aa') ? 'aa' : 'a';
        
        // 口が開きっぱなしにならないよう、Lerpで滑らかに目標値（または0）へ減衰
        const currentMouthOpen = currentVrm.expressionManager.getValue(expressionName) || 0;
        const targetMouthOpen = volume * 1.5;
        const nextMouthOpen = THREE.MathUtils.lerp(currentMouthOpen, targetMouthOpen, deltaTime * 15.0);
        currentVrm.expressionManager.setValue(expressionName, nextMouthOpen);

        // 2. 呼吸アニメーション (生命感の演出)
        breatheTime += deltaTime;
        // 浮遊アニメーションの代わりに、chestボーンを回転させて呼吸表現
        const chest = currentVrm.humanoid.getRawBoneNode('chest') || currentVrm.humanoid.getRawBoneNode('spine');
        if (chest) {
            chest.rotation.x = Math.sin(breatheTime * (Math.PI / 2)) * 0.02;
        }

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

        // Tポーズの絶対解除（ブルートフォース）
        // VRMのバージョン差異による問題や、vrm.update() による上書きを毎フレーム強制的に防ぐ
        const getBone = (name, fallbackName) => {
            if (currentVrm.humanoid.getBoneNode) {
                return currentVrm.humanoid.getBoneNode(THREE.VRMSchema?.HumanoidBoneName?.[name] || fallbackName);
            }
            return currentVrm.humanoid.getRawBoneNode(fallbackName); // VRM 1.0 向けフォールバック
        };

        const leftArm = getBone('leftUpperArm', 'leftUpperArm');
        const rightArm = getBone('rightUpperArm', 'rightUpperArm');

        if (leftArm) leftArm.rotation.z = 1.2;
        if (rightArm) rightArm.rotation.z = -1.2;
    }

    renderer.render(scene, camera);
}
