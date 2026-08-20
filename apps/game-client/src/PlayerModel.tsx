import { useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const MODEL_URL = "/models/player.gltf";

interface PlayerModelProps {
  isMoving: boolean;
}

export function PlayerModel({ isMoving }: PlayerModelProps) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);

  // The model is skinned (rigged) -- a plain Object3D.clone() does not
  // duplicate skeleton/bone bindings, so every on-screen player would end up
  // sharing (and fighting over) one skeleton. SkeletonUtils.clone() clones
  // the skinned mesh correctly, one clone per PlayerModel instance.
  const clonedScene = useMemo(() => cloneSkeleton(scene), [scene]);

  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    const action = isMoving ? actions.Walk_Loop : actions.Idle_Loop;
    action?.reset().fadeIn(0.2).play();
    return () => {
      action?.fadeOut(0.2);
    };
  }, [isMoving, actions]);

  return <primitive ref={group} object={clonedScene} />;
}

useGLTF.preload(MODEL_URL);
